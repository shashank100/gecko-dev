/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use api::{DebugCommand, DocumentId, ExternalImageData, ExternalImageId};
use api::{ImageFormat, ItemTag, NotificationRequest, Shadow, FilterOp, MAX_BLUR_RADIUS};
use api::units::*;
use api;
use crate::device::TextureFilter;
use crate::renderer::PipelineInfo;
use crate::gpu_cache::GpuCacheUpdateList;
use fxhash::FxHasher;
use plane_split::BspSplitter;
use crate::profiler::BackendProfileCounters;
use smallvec::SmallVec;
use std::{usize, i32};
use std::collections::{HashMap, HashSet};
use std::f32;
use std::hash::BuildHasherDefault;
use std::path::PathBuf;
use std::sync::Arc;

#[cfg(feature = "capture")]
use crate::capture::{CaptureConfig, ExternalCaptureImage};
#[cfg(feature = "replay")]
use crate::capture::PlainExternalImage;
use crate::tiling;

pub type FastHashMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;
pub type FastHashSet<K> = HashSet<K, BuildHasherDefault<FxHasher>>;

/// A concrete plane splitter type used in WebRender.
pub type PlaneSplitter = BspSplitter<f64, WorldPixel>;

/// An arbitrary number which we assume opacity is invisible below.
const OPACITY_EPSILON: f32 = 0.001;

/// Equivalent to api::FilterOp with added internal information
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
pub enum Filter {
    Identity,
    Blur(f32),
    Brightness(f32),
    Contrast(f32),
    Grayscale(f32),
    HueRotate(f32),
    Invert(f32),
    Opacity(api::PropertyBinding<f32>, f32),
    Saturate(f32),
    Sepia(f32),
    DropShadowStack(SmallVec<[Shadow; 1]>),
    ColorMatrix(Box<[f32; 20]>),
    SrgbToLinear,
    LinearToSrgb,
    ComponentTransfer,
}

impl Filter {
    /// Ensure that the parameters for a filter operation
    /// are sensible.
    pub fn sanitize(&mut self) {
        match self {
            Filter::Blur(ref mut radius) => {
                *radius = radius.min(MAX_BLUR_RADIUS);
            }
            Filter::DropShadowStack(ref mut stack) => {
                for shadow in stack {
                    shadow.blur_radius = shadow.blur_radius.min(MAX_BLUR_RADIUS);
                }
            }
            _ => {},
        }
    }

    pub fn is_visible(&self) -> bool {
        match *self {
            Filter::Identity |
            Filter::Blur(..) |
            Filter::Brightness(..) |
            Filter::Contrast(..) |
            Filter::Grayscale(..) |
            Filter::HueRotate(..) |
            Filter::Invert(..) |
            Filter::Saturate(..) |
            Filter::Sepia(..) |
            Filter::DropShadowStack(..) |
            Filter::ColorMatrix(..) |
            Filter::SrgbToLinear |
            Filter::LinearToSrgb |
            Filter::ComponentTransfer  => true,
            Filter::Opacity(_, amount) => {
                amount > OPACITY_EPSILON
            }
        }
    }

    pub fn is_noop(&self) -> bool {
        match *self {
            Filter::Identity => false, // this is intentional
            Filter::Blur(length) => length == 0.0,
            Filter::Brightness(amount) => amount == 1.0,
            Filter::Contrast(amount) => amount == 1.0,
            Filter::Grayscale(amount) => amount == 0.0,
            Filter::HueRotate(amount) => amount == 0.0,
            Filter::Invert(amount) => amount == 0.0,
            Filter::Opacity(_, amount) => amount >= 1.0,
            Filter::Saturate(amount) => amount == 1.0,
            Filter::Sepia(amount) => amount == 0.0,
            Filter::DropShadowStack(ref shadows) => {
                for shadow in shadows {
                    if shadow.offset.x != 0.0 || shadow.offset.y != 0.0 || shadow.blur_radius != 0.0 {
                        return false;
                    }
                }

                true
            }
            Filter::ColorMatrix(ref matrix) => {
                **matrix == [
                    1.0, 0.0, 0.0, 0.0,
                    0.0, 1.0, 0.0, 0.0,
                    0.0, 0.0, 1.0, 0.0,
                    0.0, 0.0, 0.0, 1.0,
                    0.0, 0.0, 0.0, 0.0
                ]
            }
            Filter::SrgbToLinear |
            Filter::LinearToSrgb |
            Filter::ComponentTransfer => false,
        }
    }
}

impl From<FilterOp> for Filter {
    fn from(op: FilterOp) -> Self {
        match op {
            FilterOp::Identity => Filter::Identity,
            FilterOp::Blur(r) => Filter::Blur(r),
            FilterOp::Brightness(b) => Filter::Brightness(b),
            FilterOp::Contrast(c) => Filter::Contrast(c),
            FilterOp::Grayscale(g) => Filter::Grayscale(g),
            FilterOp::HueRotate(h) => Filter::HueRotate(h),
            FilterOp::Invert(i) => Filter::Invert(i),
            FilterOp::Opacity(binding, opacity) => Filter::Opacity(binding, opacity),
            FilterOp::Saturate(s) => Filter::Saturate(s),
            FilterOp::Sepia(s) => Filter::Sepia(s),
            FilterOp::ColorMatrix(mat) => Filter::ColorMatrix(Box::new(mat)),
            FilterOp::SrgbToLinear => Filter::SrgbToLinear,
            FilterOp::LinearToSrgb => Filter::LinearToSrgb,
            FilterOp::ComponentTransfer => Filter::ComponentTransfer,
            FilterOp::DropShadow(shadow) => Filter::DropShadowStack(smallvec![shadow]),
        }
    }
}

/// An ID for a texture that is owned by the `texture_cache` module.
///
/// This can include atlases or standalone textures allocated via the texture
/// cache (e.g.  if an image is too large to be added to an atlas). The texture
/// cache manages the allocation and freeing of these IDs, and the rendering
/// thread maintains a map from cache texture ID to native texture.
///
/// We never reuse IDs, so we use a u64 here to be safe.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
pub struct CacheTextureId(pub u64);

/// Canonical type for texture layer indices.
///
/// WebRender is currently not very consistent about layer index types. Some
/// places use i32 (since that's the type used in various OpenGL APIs), some
/// places use u32 (since having it be signed is non-sensical, but the
/// underlying graphics APIs generally operate on 32-bit integers) and some
/// places use usize (since that's most natural in Rust).
///
/// Going forward, we aim to us usize throughout the codebase, since that allows
/// operations like indexing without a cast, and convert to the required type in
/// the device module when making calls into the platform layer.
pub type LayerIndex = usize;

/// Identifies a render pass target that is persisted until the end of the frame.
///
/// By default, only the targets of the immediately-preceding pass are bound as
/// inputs to the next pass. However, tasks can opt into having their target
/// preserved in a list until the end of the frame, and this type specifies the
/// index in that list.
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
pub struct SavedTargetIndex(pub usize);

impl SavedTargetIndex {
    pub const PENDING: Self = SavedTargetIndex(!0);
}

/// Identifies the source of an input texture to a shader.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
pub enum TextureSource {
    /// Equivalent to `None`, allowing us to avoid using `Option`s everywhere.
    Invalid,
    /// An entry in the texture cache.
    TextureCache(CacheTextureId),
    /// An external image texture, mananged by the embedding.
    External(ExternalImageData),
    /// The alpha target of the immediately-preceding pass.
    PrevPassAlpha,
    /// The color target of the immediately-preceding pass.
    PrevPassColor,
    /// A render target from an earlier pass. Unlike the immediately-preceding
    /// passes, these are not made available automatically, but are instead
    /// opt-in by the `RenderTask` (see `mark_for_saving()`).
    RenderTaskCache(SavedTargetIndex),
}

// See gpu_types.rs where we declare the number of possible documents and
// number of items per document. This should match up with that.
pub const ORTHO_NEAR_PLANE: f32 = -(1 << 22) as f32;
pub const ORTHO_FAR_PLANE: f32 = ((1 << 22) - 1) as f32;

#[derive(Copy, Clone, Debug, PartialEq)]
#[cfg_attr(feature = "capture", derive(Serialize))]
#[cfg_attr(feature = "replay", derive(Deserialize))]
pub struct RenderTargetInfo {
    pub has_depth: bool,
}

#[derive(Debug)]
pub enum TextureUpdateSource {
    External {
        id: ExternalImageId,
        channel_index: u8,
    },
    Bytes { data: Arc<Vec<u8>> },
    /// Clears the target area, rather than uploading any pixels. Used when the
    /// texture cache debug display is active.
    DebugClear,
}

/// Command to allocate, reallocate, or free a texture for the texture cache.
#[derive(Debug)]
pub struct TextureCacheAllocation {
    /// The virtual ID (i.e. distinct from device ID) of the texture.
    pub id: CacheTextureId,
    /// Details corresponding to the operation in question.
    pub kind: TextureCacheAllocationKind,
}

/// Information used when allocating / reallocating.
#[derive(Debug)]
pub struct TextureCacheAllocInfo {
    pub width: i32,
    pub height: i32,
    pub layer_count: i32,
    pub format: ImageFormat,
    pub filter: TextureFilter,
    /// Indicates whether this corresponds to one of the shared texture caches.
    pub is_shared_cache: bool,
}

/// Sub-operation-specific information for allocation operations.
#[derive(Debug)]
pub enum TextureCacheAllocationKind {
    /// Performs an initial texture allocation.
    Alloc(TextureCacheAllocInfo),
    /// Reallocates the texture. The existing live texture with the same id
    /// will be deallocated and its contents blitted over. The new size must
    /// be greater than the old size.
    Realloc(TextureCacheAllocInfo),
    /// Reallocates the texture without preserving its contents.
    Reset(TextureCacheAllocInfo),
    /// Frees the texture and the corresponding cache ID.
    Free,
}

/// Command to update the contents of the texture cache.
#[derive(Debug)]
pub struct TextureCacheUpdate {
    pub id: CacheTextureId,
    pub rect: DeviceIntRect,
    pub stride: Option<i32>,
    pub offset: i32,
    pub layer_index: i32,
    pub source: TextureUpdateSource,
}

/// Atomic set of commands to manipulate the texture cache, generated on the
/// RenderBackend thread and executed on the Renderer thread.
///
/// The list of allocation operations is processed before the updates. This is
/// important to allow coalescing of certain allocation operations.
#[derive(Default)]
pub struct TextureUpdateList {
    /// Indicates that there was some kind of cleanup clear operation. Used for
    /// sanity checks.
    pub clears_shared_cache: bool,
    /// Commands to alloc/realloc/free the textures. Processed first.
    pub allocations: Vec<TextureCacheAllocation>,
    /// Commands to update the contents of the textures. Processed second.
    pub updates: Vec<TextureCacheUpdate>,
}

impl TextureUpdateList {
    /// Mints a new `TextureUpdateList`.
    pub fn new() -> Self {
        TextureUpdateList {
            clears_shared_cache: false,
            allocations: Vec::new(),
            updates: Vec::new(),
        }
    }

    /// Sets the clears_shared_cache flag for renderer-side sanity checks.
    #[inline]
    pub fn note_clear(&mut self) {
        self.clears_shared_cache = true;
    }

    /// Pushes an update operation onto the list.
    #[inline]
    pub fn push_update(&mut self, update: TextureCacheUpdate) {
        self.updates.push(update);
    }

    /// Sends a command to the Renderer to clear the portion of the shared region
    /// we just freed. Used when the texture cache debugger is enabled.
    #[cold]
    pub fn push_debug_clear(
        &mut self,
        id: CacheTextureId,
        origin: DeviceIntPoint,
        width: i32,
        height: i32,
        layer_index: usize
    ) {
        let size = DeviceIntSize::new(width, height);
        let rect = DeviceIntRect::new(origin, size);
        self.push_update(TextureCacheUpdate {
            id,
            rect,
            source: TextureUpdateSource::DebugClear,
            stride: None,
            offset: 0,
            layer_index: layer_index as i32,
        });
    }


    /// Pushes an allocation operation onto the list.
    pub fn push_alloc(&mut self, id: CacheTextureId, info: TextureCacheAllocInfo) {
        debug_assert!(!self.allocations.iter().any(|x| x.id == id));
        self.allocations.push(TextureCacheAllocation {
            id,
            kind: TextureCacheAllocationKind::Alloc(info),
        });
    }

    /// Pushes a reallocation operation onto the list, potentially coalescing
    /// with previous operations.
    pub fn push_realloc(&mut self, id: CacheTextureId, info: TextureCacheAllocInfo) {
        self.debug_assert_coalesced(id);

        // Coallesce this realloc into a previous alloc or realloc, if available.
        if let Some(cur) = self.allocations.iter_mut().find(|x| x.id == id) {
            match cur.kind {
                TextureCacheAllocationKind::Alloc(ref mut i) => *i = info,
                TextureCacheAllocationKind::Realloc(ref mut i) => *i = info,
                TextureCacheAllocationKind::Reset(ref mut i) => *i = info,
                TextureCacheAllocationKind::Free => panic!("Reallocating freed texture"),
            }
            return
        }

        self.allocations.push(TextureCacheAllocation {
            id,
            kind: TextureCacheAllocationKind::Realloc(info),
        });
    }

    /// Pushes a reallocation operation onto the list, potentially coalescing
    /// with previous operations.
    pub fn push_reset(&mut self, id: CacheTextureId, info: TextureCacheAllocInfo) {
        self.debug_assert_coalesced(id);

        // Coallesce this realloc into a previous alloc or realloc, if available.
        if let Some(cur) = self.allocations.iter_mut().find(|x| x.id == id) {
            match cur.kind {
                TextureCacheAllocationKind::Alloc(ref mut i) => *i = info,
                TextureCacheAllocationKind::Reset(ref mut i) => *i = info,
                TextureCacheAllocationKind::Free => panic!("Resetting freed texture"),
                TextureCacheAllocationKind::Realloc(_) => {
                    // Reset takes precedence over realloc
                    cur.kind = TextureCacheAllocationKind::Reset(info);
                }
            }
            return
        }

        self.allocations.push(TextureCacheAllocation {
            id,
            kind: TextureCacheAllocationKind::Reset(info),
        });
    }

    /// Pushes a free operation onto the list, potentially coalescing with
    /// previous operations.
    pub fn push_free(&mut self, id: CacheTextureId) {
        self.debug_assert_coalesced(id);

        // Drop any unapplied updates to the to-be-freed texture.
        self.updates.retain(|x| x.id != id);

        // Drop any allocations for it as well. If we happen to be allocating and
        // freeing in the same batch, we can collapse them to a no-op.
        let idx = self.allocations.iter().position(|x| x.id == id);
        let removed_kind = idx.map(|i| self.allocations.remove(i).kind);
        match removed_kind {
            Some(TextureCacheAllocationKind::Alloc(..)) => { /* no-op! */ },
            Some(TextureCacheAllocationKind::Free) => panic!("Double free"),
            Some(TextureCacheAllocationKind::Realloc(..)) |
            Some(TextureCacheAllocationKind::Reset(..)) |
            None => {
                self.allocations.push(TextureCacheAllocation {
                    id,
                    kind: TextureCacheAllocationKind::Free,
                });
            }
        };
    }

    fn debug_assert_coalesced(&self, id: CacheTextureId) {
        debug_assert!(
            self.allocations.iter().filter(|x| x.id == id).count() <= 1,
            "Allocations should have been coalesced",
        );
    }
}

/// Wraps a tiling::Frame, but conceptually could hold more information
pub struct RenderedDocument {
    pub frame: tiling::Frame,
    pub is_new_scene: bool,
}

pub enum DebugOutput {
    FetchDocuments(String),
    FetchClipScrollTree(String),
    #[cfg(feature = "capture")]
    SaveCapture(CaptureConfig, Vec<ExternalCaptureImage>),
    #[cfg(feature = "replay")]
    LoadCapture(PathBuf, Vec<PlainExternalImage>),
}

#[allow(dead_code)]
pub enum ResultMsg {
    DebugCommand(DebugCommand),
    DebugOutput(DebugOutput),
    RefreshShader(PathBuf),
    UpdateGpuCache(GpuCacheUpdateList),
    UpdateResources {
        updates: TextureUpdateList,
        memory_pressure: bool,
    },
    PublishPipelineInfo(PipelineInfo),
    PublishDocument(
        DocumentId,
        RenderedDocument,
        TextureUpdateList,
        BackendProfileCounters,
    ),
    AppendNotificationRequests(Vec<NotificationRequest>),
}

#[derive(Clone, Debug)]
pub struct ResourceCacheError {
    description: String,
}

impl ResourceCacheError {
    pub fn new(description: String) -> ResourceCacheError {
        ResourceCacheError {
            description,
        }
    }
}

/// Primitive metadata we pass around in a bunch of places
#[derive(Copy, Clone, Debug)]
pub struct LayoutPrimitiveInfo {
    /// NOTE: this is *ideally* redundant with the clip_rect
    /// but that's an ongoing project, so for now it exists and is used :(
    pub rect: LayoutRect,
    pub clip_rect: LayoutRect,
    pub is_backface_visible: bool,
    pub hit_info: Option<ItemTag>,
}

impl LayoutPrimitiveInfo {
    pub fn with_clip_rect(rect: LayoutRect, clip_rect: LayoutRect) -> Self {
        Self {
            rect,
            clip_rect,
            is_backface_visible: true,
            hit_info: None,
        }
    }
}
