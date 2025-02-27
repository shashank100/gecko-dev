/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

 async function reparentItem(db, guid, newParentGuid = null) {
   await db.execute(`
     UPDATE moz_bookmarks SET
       parent = IFNULL((SELECT id FROM moz_bookmarks
                        WHERE guid = :newParentGuid), 0)
     WHERE guid = :guid`,
     { newParentGuid, guid });
 }

async function getCountOfBookmarkRows(db) {
  let queryRows = await db.execute("SELECT COUNT(*) FROM moz_bookmarks");
  Assert.equal(queryRows.length, 1);
  return queryRows[0].getResultByIndex(0);
}

add_task(async function test_multiple_parents() {
  let buf = await openMirror("multiple_parents");
  let now = Date.now();

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make remote changes");
  await storeRecords(buf, [{
    id: "toolbar",
    parentid: "places",
    type: "folder",
    modified: now / 1000 - 10,
    children: ["bookmarkAAAA"],
  }, {
    id: "menu",
    parentid: "places",
    type: "folder",
    modified: now / 1000 - 5,
    children: ["bookmarkAAAA", "bookmarkBBBB", "bookmarkCCCC"],
  }, {
    id: "unfiled",
    parentid: "places",
    type: "folder",
    modified: now / 1000 - 3,
    children: ["bookmarkBBBB"],
  }, {
    id: "mobile",
    parentid: "places",
    type: "folder",
    modified: now / 1000,
    children: ["bookmarkCCCC"],
  }, {
    id: "bookmarkAAAA",
    parentid: "toolbar",
    type: "bookmark",
    title: "A",
    modified: now / 1000 - 10,
    bmkUri: "http://example.com/a",
  }, {
    id: "bookmarkBBBB",
    parentid: "mobile",
    type: "bookmark",
    title: "B",
    modified: now / 1000 - 3,
    bmkUri: "http://example.com/b",
  }]);

  info("Apply remote");
  let changesToUpload = await buf.apply({
    localTimeSeconds: now / 1000,
    remoteTimeSeconds: now / 1000,
  });
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let datesAdded = await promiseManyDatesAdded([PlacesUtils.bookmarks.menuGuid,
    PlacesUtils.bookmarks.toolbarGuid, PlacesUtils.bookmarks.unfiledGuid,
    PlacesUtils.bookmarks.mobileGuid, "bookmarkAAAA", "bookmarkBBBB"]);
  deepEqual(changesToUpload, {
    menu: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "menu",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.menuGuid),
        title: BookmarksMenuTitle,
        children: ["bookmarkAAAA"],
      },
    },
    toolbar: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "toolbar",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.toolbarGuid),
        title: BookmarksToolbarTitle,
        children: [],
      },
    },
    unfiled: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "unfiled",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.unfiledGuid),
        title: UnfiledBookmarksTitle,
        children: ["bookmarkBBBB"],
      },
    },
    mobile: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "mobile",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.mobileGuid),
        title: MobileBookmarksTitle,
        children: [],
      },
    },
    bookmarkAAAA: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkAAAA",
        type: "bookmark",
        parentid: "menu",
        hasDupe: true,
        parentName: BookmarksMenuTitle,
        dateAdded: datesAdded.get("bookmarkAAAA"),
        bmkUri: "http://example.com/a",
        title: "A",
      },
    },
    bookmarkBBBB: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkBBBB",
        type: "bookmark",
        parentid: "unfiled",
        hasDupe: true,
        parentName: UnfiledBookmarksTitle,
        dateAdded: datesAdded.get("bookmarkBBBB"),
        bmkUri: "http://example.com/b",
        title: "B",
      },
    },
  });

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkAAAA",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "A",
        url: "http://example.com/a",
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
      children: [{
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "B",
        url: "http://example.com/b",
      }],
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should parent (A B) correctly");

  await storeChangesInMirror(buf, changesToUpload);

  ok(!(await buf.hasChanges()),
    "Should not report local or remote changes after updating mirror");

  let newChangesToUpload = await buf.forceApply({
    localTimeSeconds: now / 1000,
    remoteTimeSeconds: now / 1000,
  });
  deepEqual(newChangesToUpload, {},
    "Should not upload any changes after updating mirror");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_reupload_replace() {
  let buf = await openMirror("reupload_replace");

  info("Set up mirror");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.menuGuid,
    children: [{
      guid: "bookmarkAAAA",
      title: "A",
      url: "http://example.com/a",
    }, {
      guid: "folderBBBBBB",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "B",
    }],
  });
  await PlacesTestUtils.markBookmarksAsSynced();
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["bookmarkAAAA", "folderBBBBBB"],
  }, {
    id: "bookmarkAAAA",
    parentid: "menu",
    type: "bookmark",
    title: "A",
    bmkUri: "http://example.com/a",
  }, {
    id: "folderBBBBBB",
    parentid: "menu",
    type: "folder",
    title: "B",
    children: [],
  }], { needsMerge: false });

  info("Make remote changes");
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["bookmarkAAAA", "folderBBBBBB", "queryCCCCCCC", "queryDDDDDDD"],
  }, {
    // A has an invalid URL, but exists locally, so we should reupload a valid
    // local copy. This discards _all_ remote changes to A.
    id: "bookmarkAAAA",
    parentid: "menu",
    type: "bookmark",
    title: "A (remote)",
    bmkUri: "!@#$%",
  }, {
    id: "folderBBBBBB",
    parentid: "menu",
    type: "folder",
    title: "B (remote)",
    children: ["bookmarkEEEE"],
  }, {
    // E is a bookmark with an invalid URL that doesn't exist locally, so we'll
    // delete it.
    id: "bookmarkEEEE",
    parentid: "folderBBBBBB",
    type: "bookmark",
    title: "E (remote)",
    bmkUri: "!@#$%",
  }, {
    // C is a legacy tag query, so we'll rewrite its URL and reupload it.
    id: "queryCCCCCCC",
    parentid: "menu",
    type: "query",
    title: "C (remote)",
    bmkUri: "place:type=7&folder=999",
    folderName: "taggy",
  }, {
    // D is a query with an invalid URL, so we'll delete it.
    id: "queryDDDDDDD",
    parentid: "menu",
    type: "query",
    title: "D",
    bmkUri: "^&*()",
  }]);

  info("Apply remote");
  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let datesAdded = await promiseManyDatesAdded([PlacesUtils.bookmarks.menuGuid,
    "bookmarkAAAA"]);
  deepEqual(changesToUpload, {
    menu: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "menu",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.menuGuid),
        title: BookmarksMenuTitle,
        children: ["bookmarkAAAA", "folderBBBBBB", "queryCCCCCCC"],
      },
    },
    bookmarkAAAA: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkAAAA",
        type: "bookmark",
        parentid: "menu",
        hasDupe: true,
        parentName: BookmarksMenuTitle,
        dateAdded: datesAdded.get("bookmarkAAAA"),
        bmkUri: "http://example.com/a",
        title: "A",
      },
    },
    folderBBBBBB: {
      // B is reuploaded because we deleted its child E.
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderBBBBBB",
        type: "folder",
        parentid: "menu",
        hasDupe: true,
        parentName: BookmarksMenuTitle,
        dateAdded: undefined,
        title: "B (remote)",
        children: [],
      },
    },
    queryCCCCCCC: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "queryCCCCCCC",
        type: "query",
        parentid: "menu",
        hasDupe: true,
        parentName: BookmarksMenuTitle,
        dateAdded: undefined,
        bmkUri: "place:tag=taggy",
        title: "C (remote)",
        folderName: "taggy",
      },
    },
    queryDDDDDDD: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "queryDDDDDDD",
        deleted: true,
      },
    },
    bookmarkEEEE: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkEEEE",
        deleted: true,
      },
    },
  });

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_corrupt_local_roots() {
  let buf = await openMirror("corrupt_roots");

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make remote changes");
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["bookmarkAAAA"],
  }, {
    id: "bookmarkAAAA",
    parentid: "menu",
    type: "bookmark",
    title: "A",
    bmkUri: "http://example.com/a",
  }, {
    id: "toolbar",
    parentid: "places",
    type: "folder",
    children: ["bookmarkBBBB"],
  }, {
    id: "bookmarkBBBB",
    parentid: "toolbar",
    type: "bookmark",
    title: "B",
    bmkUri: "http://example.com/b",
  }]);

  try {
    info("Move local menu into unfiled");
    await reparentItem(buf.db, PlacesUtils.bookmarks.menuGuid,
                       PlacesUtils.bookmarks.unfiledGuid);
    await Assert.rejects(buf.apply(), /Local tree has misparented root/,
      "Should abort merge if local tree has misparented syncable root");

    info("Move local Places root into toolbar");
    await buf.db.executeTransaction(async function() {
      await reparentItem(buf.db, PlacesUtils.bookmarks.menuGuid,
                         PlacesUtils.bookmarks.rootGuid);
      await reparentItem(buf.db, PlacesUtils.bookmarks.rootGuid,
                         PlacesUtils.bookmarks.toolbarGuid);
    });
    await Assert.rejects(buf.apply(), /Local tree has misparented root/,
      "Should abort merge if local tree has misparented Places root");
  } finally {
    info("Restore local roots");
    await buf.db.executeTransaction(async function() {
      await reparentItem(buf.db, PlacesUtils.bookmarks.rootGuid);
      await reparentItem(buf.db, PlacesUtils.bookmarks.menuGuid,
                         PlacesUtils.bookmarks.rootGuid);
    });
  }

  info("Apply remote with restored roots");
  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  deepEqual(changesToUpload, {}, "Should not reupload any local records");

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkAAAA",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "A",
        url: "http://example.com/a",
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
      children: [{
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "B",
        url: "http://example.com/b",
      }],
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should parent (A B) correctly with restored roots");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_corrupt_remote_roots() {
  let buf = await openMirror("corrupt_remote_roots");

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make remote changes: Menu > Unfiled");
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["unfiled", "bookmarkAAAA"],
  }, {
    id: "unfiled",
    parentid: "menu",
    type: "folder",
    children: ["bookmarkBBBB"],
  }, {
    id: "bookmarkAAAA",
    parentid: "menu",
    type: "bookmark",
    title: "A",
    bmkUri: "http://example.com/a",
  }, {
    id: "bookmarkBBBB",
    parentid: "unfiled",
    type: "bookmark",
    title: "B",
    bmkUri: "http://example.com/b",
  }, {
    id: "toolbar",
    deleted: true,
  }]);

  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let datesAdded = await promiseManyDatesAdded([
    PlacesUtils.bookmarks.menuGuid,
    PlacesUtils.bookmarks.unfiledGuid,
    PlacesUtils.bookmarks.toolbarGuid,
  ]);
  deepEqual(changesToUpload, {
    menu: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "menu",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.menuGuid),
        title: BookmarksMenuTitle,
        children: ["bookmarkAAAA"],
      },
    },
    unfiled: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "unfiled",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.unfiledGuid),
        title: UnfiledBookmarksTitle,
        children: ["bookmarkBBBB"],
      },
    },
    toolbar: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "toolbar",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.toolbarGuid),
        title: BookmarksToolbarTitle,
        children: [],
      },
    },
  }, "Should reupload invalid roots");

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkAAAA",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "A",
        url: "http://example.com/a",
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
      children: [{
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "B",
        url: "http://example.com/b",
      }],
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should not corrupt local roots");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_missing_children() {
  let buf = await openMirror("missing_childen");

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make remote changes: A > ([B] C [D E])");
  {
    await storeRecords(buf, shuffle([{
      id: "menu",
      parentid: "places",
      type: "folder",
      children: ["bookmarkBBBB", "bookmarkCCCC", "bookmarkDDDD",
                 "bookmarkEEEE"],
    }, {
      id: "bookmarkCCCC",
      parentid: "menu",
      type: "bookmark",
      bmkUri: "http://example.com/c",
      title: "C",
    }]));
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["menu"],
      deleted: [],
    }, "Should reupload menu without missing children (B D E)");
    await assertLocalTree(PlacesUtils.bookmarks.menuGuid, {
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkCCCC",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "C",
        url: "http://example.com/c",
      }],
    }, "Menu children should be (C)");
    deepEqual(await buf.fetchRemoteOrphans(), {
      missingChildren: ["bookmarkBBBB", "bookmarkDDDD", "bookmarkEEEE"],
      missingParents: [],
      parentsWithGaps: [],
    }, "Should report (B D E) as missing");
    await storeChangesInMirror(buf, changesToUpload);
  }

  info("Add (B E) to remote");
  {
    await storeRecords(buf, shuffle([{
      id: "bookmarkBBBB",
      parentid: "menu",
      type: "bookmark",
      title: "B",
      bmkUri: "http://example.com/b",
    }, {
      id: "bookmarkEEEE",
      parentid: "menu",
      type: "bookmark",
      title: "E",
      bmkUri: "http://example.com/e",
    }]));
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["bookmarkBBBB", "bookmarkEEEE", "menu"],
      deleted: [],
    }, "Should reupload menu and restored children");
    await assertLocalTree(PlacesUtils.bookmarks.menuGuid, {
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkCCCC",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "C",
        url: "http://example.com/c",
      }, {
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 1,
        title: "B",
        url: "http://example.com/b",
      }, {
        guid: "bookmarkEEEE",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 2,
        title: "E",
        url: "http://example.com/e",
      }],
    }, "Menu children should be (C B E)");
    deepEqual(await buf.fetchRemoteOrphans(), {
      missingChildren: [],
      missingParents: ["bookmarkBBBB", "bookmarkEEEE"],
      parentsWithGaps: [],
    }, "Should report missing parents for (B E)");
    await storeChangesInMirror(buf, changesToUpload);
  }

  info("Add D to remote");
  {
    await storeRecords(buf, [{
      id: "bookmarkDDDD",
      parentid: "menu",
      type: "bookmark",
      title: "D",
      bmkUri: "http://example.com/d",
    }]);
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["bookmarkDDDD", "menu"],
      deleted: [],
    }, "Should reupload complete menu");
    await assertLocalTree(PlacesUtils.bookmarks.menuGuid, {
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkCCCC",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "C",
        url: "http://example.com/c",
      }, {
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 1,
        title: "B",
        url: "http://example.com/b",
      }, {
        guid: "bookmarkEEEE",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 2,
        title: "E",
        url: "http://example.com/e",
      }, {
        guid: "bookmarkDDDD",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 3,
        title: "D",
        url: "http://example.com/d",
      }],
    }, "Menu children should be (C B E D)");
    deepEqual(await buf.fetchRemoteOrphans(), {
      missingChildren: [],
      missingParents: ["bookmarkDDDD"],
      parentsWithGaps: [],
    }, "Should report missing parent for D");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_new_orphan_without_local_parent() {
  let buf = await openMirror("new_orphan_without_local_parent");

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  // A doesn't exist locally, so we move the bookmarks into "unfiled" without
  // reuploading. When the partial uploader returns and uploads A, we'll
  // move the bookmarks to the correct folder.
  info("Make remote changes: [A] > (B C D)");
  await storeRecords(buf, shuffle([{
    id: "bookmarkBBBB",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "B (remote)",
    bmkUri: "http://example.com/b-remote",
  }, {
    id: "bookmarkCCCC",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "C (remote)",
    bmkUri: "http://example.com/c-remote",
  }, {
    id: "bookmarkDDDD",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "D (remote)",
    bmkUri: "http://example.com/d-remote",
  }]));

  info("Apply remote with (B C D)");
  {
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");
    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["bookmarkBBBB", "bookmarkCCCC", "bookmarkDDDD", "unfiled"],
      deleted: [],
    }, "Should reupload orphans (B C D)");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await assertLocalTree(PlacesUtils.bookmarks.unfiledGuid, {
    guid: PlacesUtils.bookmarks.unfiledGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 3,
    title: UnfiledBookmarksTitle,
    children: [{
      guid: "bookmarkBBBB",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 0,
      title: "B (remote)",
      url: "http://example.com/b-remote",
    }, {
      guid: "bookmarkCCCC",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 1,
      title: "C (remote)",
      url: "http://example.com/c-remote",
    }, {
      guid: "bookmarkDDDD",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 2,
      title: "D (remote)",
      url: "http://example.com/d-remote",
    }],
  }, "Should move (B C D) to unfiled");

  // A is an orphan because we don't have E locally, but we should move
  // (B C D) into A.
  info("Add [E] > A to remote");
  await storeRecords(buf, [{
    id: "folderAAAAAA",
    parentid: "folderEEEEEE",
    type: "folder",
    title: "A",
    children: ["bookmarkDDDD", "bookmarkCCCC", "bookmarkBBBB"],
  }]);

  info("Apply remote with A");
  {
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");
    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["bookmarkBBBB", "bookmarkCCCC", "bookmarkDDDD", "folderAAAAAA", "unfiled"],
      deleted: [],
    }, "Should reupload A and its children");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await assertLocalTree(PlacesUtils.bookmarks.unfiledGuid, {
    guid: PlacesUtils.bookmarks.unfiledGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 3,
    title: UnfiledBookmarksTitle,
    children: [{
      guid: "folderAAAAAA",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: "A",
      children: [{
        guid: "bookmarkDDDD",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "D (remote)",
        url: "http://example.com/d-remote",
      }, {
        guid: "bookmarkCCCC",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 1,
        title: "C (remote)",
        url: "http://example.com/c-remote",
      }, {
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 2,
        title: "B (remote)",
        url: "http://example.com/b-remote",
      }],
    }],
  }, "Should move (D C B) into A");

  info("Add E to remote");
  await storeRecords(buf, [{
    id: "folderEEEEEE",
    parentid: "menu",
    type: "folder",
    title: "E",
    children: ["folderAAAAAA"],
  }]);

  info("Apply remote with E");
  {
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");
    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["folderAAAAAA", "folderEEEEEE", "menu", "unfiled"],
      deleted: [],
    }, "Should move E out of unfiled into menu");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await assertLocalTree(PlacesUtils.bookmarks.menuGuid, {
    guid: PlacesUtils.bookmarks.menuGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: BookmarksMenuTitle,
    children: [{
      guid: "folderEEEEEE",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: "E",
      children: [{
        guid: "folderAAAAAA",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        index: 0,
        title: "A",
        children: [{
          guid: "bookmarkDDDD",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 0,
          title: "D (remote)",
          url: "http://example.com/d-remote",
        }, {
          guid: "bookmarkCCCC",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 1,
          title: "C (remote)",
          url: "http://example.com/c-remote",
        }, {
          guid: "bookmarkBBBB",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 2,
          title: "B (remote)",
          url: "http://example.com/b-remote",
        }],
      }],
    }],
  }, "Should move Menu > E > A");

  info("Add Menu > E to remote");
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["folderEEEEEE"],
  }]);

  info("Apply remote with menu");
  {
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");
    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: [],
      deleted: [],
    }, "Should not reupload after forming complete tree");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "folderEEEEEE",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        index: 0,
        title: "E",
        children: [{
          guid: "folderAAAAAA",
          type: PlacesUtils.bookmarks.TYPE_FOLDER,
          index: 0,
          title: "A",
          children: [{
            guid: "bookmarkDDDD",
            type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
            index: 0,
            title: "D (remote)",
            url: "http://example.com/d-remote",
          }, {
            guid: "bookmarkCCCC",
            type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
            index: 1,
            title: "C (remote)",
            url: "http://example.com/c-remote",
          }, {
            guid: "bookmarkBBBB",
            type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
            index: 2,
            title: "B (remote)",
            url: "http://example.com/b-remote",
          }],
        }],
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should form complete tree after applying E");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_move_into_orphaned() {
  let buf = await openMirror("move_into_orphaned");

  info("Set up mirror: Menu > (A B (C > (D (E > F))))");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.menuGuid,
    children: [{
      guid: "bookmarkAAAA",
      url: "http://example.com/a",
      title: "A",
    }, {
      guid: "bookmarkBBBB",
      url: "http://example.com/b",
      title: "B",
    }, {
      guid: "folderCCCCCC",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "C",
      children: [{
        guid: "bookmarkDDDD",
        title: "D",
        url: "http://example.com/d",
      }, {
        guid: "folderEEEEEE",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        title: "E",
        children: [{
          guid: "bookmarkFFFF",
          title: "F",
          url: "http://example.com/f",
        }],
      }],
    }],
  });
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["bookmarkAAAA", "bookmarkBBBB", "folderCCCCCC"],
  }, {
    id: "bookmarkAAAA",
    parentid: "menu",
    type: "bookmark",
    title: "A",
    bmkUri: "http://example.com/a",
  }, {
    id: "bookmarkBBBB",
    parentid: "menu",
    type: "bookmark",
    title: "B",
    bmkUri: "http://example.com/b",
  }, {
    id: "folderCCCCCC",
    parentid: "menu",
    type: "folder",
    title: "C",
    children: ["bookmarkDDDD", "folderEEEEEE"],
  }, {
    id: "bookmarkDDDD",
    parentid: "folderCCCCCC",
    type: "bookmark",
    title: "D",
    bmkUri: "http://example.com/d",
  }, {
    id: "folderEEEEEE",
    parentid: "folderCCCCCC",
    type: "folder",
    title: "E",
    children: ["bookmarkFFFF"],
  }, {
    id: "bookmarkFFFF",
    parentid: "folderEEEEEE",
    type: "bookmark",
    title: "F",
    bmkUri: "http://example.com/f",
  }], { needsMerge: false });
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make local changes: delete D, add E > I");
  await PlacesUtils.bookmarks.remove("bookmarkDDDD");
  await PlacesUtils.bookmarks.insert({
    guid: "bookmarkIIII",
    parentGuid: "folderEEEEEE",
    title: "I (local)",
    url: "http://example.com/i",
  });

  // G doesn't exist on the server.
  info("Make remote changes: ([G] > A (C > (D H E))), (C > H)");
  await storeRecords(buf, shuffle([{
    id: "bookmarkAAAA",
    parentid: "folderGGGGGG",
    type: "bookmark",
    title: "A",
    bmkUri: "http://example.com/a",
  }, {
    id: "folderCCCCCC",
    parentid: "folderGGGGGG",
    type: "folder",
    title: "C",
    children: ["bookmarkDDDD", "bookmarkHHHH", "folderEEEEEE"],
  }, {
    id: "bookmarkHHHH",
    parentid: "folderCCCCCC",
    type: "bookmark",
    title: "H (remote)",
    bmkUri: "http://example.com/h-remote",
  }]));

  info("Apply remote");
  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let idsToUpload = inspectChangeRecords(changesToUpload);
  deepEqual(idsToUpload, {
    updated: ["bookmarkAAAA", "bookmarkIIII", "folderCCCCCC", "folderEEEEEE", "menu"],
    deleted: ["bookmarkDDDD"],
  }, "Should upload records for (A I C E); tombstone for D");

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        // A remains in its original place, since we don't use the `parentid`,
        // and we don't have a record for G.
        guid: "bookmarkAAAA",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "A",
        url: "http://example.com/a",
      }, {
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 1,
        title: "B",
        url: "http://example.com/b",
      }, {
        // C exists on the server, so we take its children and order. D was
        // deleted locally, and doesn't exist remotely. C is also a child of
        // G, but we don't have a record for it on the server.
        guid: "folderCCCCCC",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        index: 2,
        title: "C",
        children: [{
          guid: "bookmarkHHHH",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 0,
          title: "H (remote)",
          url: "http://example.com/h-remote",
        }, {
          guid: "folderEEEEEE",
          type: PlacesUtils.bookmarks.TYPE_FOLDER,
          index: 1,
          title: "E",
          children: [{
            guid: "bookmarkFFFF",
            type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
            index: 0,
            title: "F",
            url: "http://example.com/f",
          }, {
            guid: "bookmarkIIII",
            type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
            index: 1,
            title: "I (local)",
            url: "http://example.com/i",
          }],
        }],
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should treat local tree as canonical if server is missing new parent");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_new_orphan_with_local_parent() {
  let buf = await openMirror("new_orphan_with_local_parent");

  info("Set up mirror: A > (B D)");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.menuGuid,
    children: [{
      guid: "folderAAAAAA",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "A",
      children: [{
        guid: "bookmarkBBBB",
        url: "http://example.com/b",
        title: "B",
      }, {
        guid: "bookmarkEEEE",
        url: "http://example.com/e",
        title: "E",
      }],
    }],
  });
  await storeRecords(buf, shuffle([{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["folderAAAAAA"],
  }, {
    id: "folderAAAAAA",
    parentid: "menu",
    type: "folder",
    title: "A",
    children: ["bookmarkBBBB", "bookmarkEEEE"],
  }, {
    id: "bookmarkBBBB",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "B",
    bmkUri: "http://example.com/b",
  }, {
    id: "bookmarkEEEE",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "E",
    bmkUri: "http://example.com/e",
  }]), { needsMerge: false });
  await PlacesTestUtils.markBookmarksAsSynced();

  // Simulate a partial write by another device that uploaded only B and C. A
  // exists locally, so we can move B and C into the correct folder, but not
  // the correct positions.
  info("Set up remote with orphans: [A] > (C D)");
  await storeRecords(buf, [{
    id: "bookmarkDDDD",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "D (remote)",
    bmkUri: "http://example.com/d-remote",
  }, {
    id: "bookmarkCCCC",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "C (remote)",
    bmkUri: "http://example.com/c-remote",
  }]);

  info("Apply remote with (C D)");
  {
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");
    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: ["bookmarkCCCC", "bookmarkDDDD", "folderAAAAAA"],
      deleted: [],
    }, "Should reupload orphans (C D) and folder A");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "folderAAAAAA",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        index: 0,
        title: "A",
        children: [{
          guid: "bookmarkBBBB",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 0,
          title: "B",
          url: "http://example.com/b",
        }, {
          guid: "bookmarkEEEE",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 1,
          title: "E",
          url: "http://example.com/e",
        }, {
          guid: "bookmarkCCCC",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 2,
          title: "C (remote)",
          url: "http://example.com/c-remote",
        }, {
          guid: "bookmarkDDDD",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          index: 3,
          title: "D (remote)",
          url: "http://example.com/d-remote",
        }],
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should move (C D) to end of A");

  // The partial uploader returns and uploads A.
  info("Add A to remote");
  await storeRecords(buf, [{
    id: "folderAAAAAA",
    parentid: "menu",
    type: "folder",
    title: "A",
    children: ["bookmarkCCCC", "bookmarkDDDD", "bookmarkEEEE", "bookmarkBBBB"],
  }]);

  info("Apply remote with A");
  {
    let changesToUpload = await buf.apply();
    deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");
    let idsToUpload = inspectChangeRecords(changesToUpload);
    deepEqual(idsToUpload, {
      updated: [],
      deleted: [],
    }, "Should not reupload orphan A");
    await storeChangesInMirror(buf, changesToUpload);
  }

  await assertLocalTree("folderAAAAAA", {
    guid: "folderAAAAAA",
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "A",
    children: [{
      guid: "bookmarkCCCC",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 0,
      title: "C (remote)",
      url: "http://example.com/c-remote",
    }, {
      guid: "bookmarkDDDD",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 1,
      title: "D (remote)",
      url: "http://example.com/d-remote",
    }, {
      guid: "bookmarkEEEE",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 2,
      title: "E",
      url: "http://example.com/e",
    }, {
      guid: "bookmarkBBBB",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 3,
      title: "B",
      url: "http://example.com/b",
    }],
  }, "Should update child positions once A exists in mirror");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_tombstone_as_child() {
  await PlacesTestUtils.markBookmarksAsSynced();

  let buf = await openMirror("tombstone_as_child");
  // Setup the mirror such that an incoming folder references a tombstone
  // as a child.
  await storeRecords(buf, shuffle([{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["folderAAAAAA"],
  }, {
    id: "folderAAAAAA",
    parentid: "menu",
    type: "folder",
    title: "A",
    children: ["bookmarkAAAA", "bookmarkTTTT", "bookmarkBBBB"],
  }, {
    id: "bookmarkAAAA",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "Bookmark A",
    bmkUri: "http://example.com/a",
  }, {
    id: "bookmarkBBBB",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "Bookmark B",
    bmkUri: "http://example.com/b",
  }, {
    id: "bookmarkTTTT",
    deleted: true,
  }]), { needsMerge: true });

  let changesToUpload = await buf.apply();
  let idsToUpload = inspectChangeRecords(changesToUpload);
  deepEqual(idsToUpload.deleted, [], "no new tombstones were created.");
  deepEqual(idsToUpload.updated, ["folderAAAAAA"], "parent is re-uploaded");

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "folderAAAAAA",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        index: 0,
        title: "A",
        children: [{
          guid: "bookmarkAAAA",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          url: "http://example.com/a",
          index: 0,
          title: "Bookmark A",
        }, {
          // Note that this was the 3rd child specified on the server record,
          // but we we've correctly moved it back to being the second after
          // ignoring the tombstone.
          guid: "bookmarkBBBB",
          type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
          url: "http://example.com/b",
          index: 1,
          title: "Bookmark B",
        }],
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should have ignored tombstone record");
  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_non_syncable_items() {
  let buf = await openMirror("non_syncable_items");

  info("Insert local orphaned left pane queries");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.unfiledGuid,
    children: [{
      guid: "folderLEFTPQ",
      url: "place:folder=SOMETHING",
      title: "Some query",
    }, {
      guid: "folderLEFTPC",
      url: "place:folder=SOMETHING_ELSE",
      title: "A query under 'All Bookmarks'",
    }],
  });

  info("Insert syncable local items (A > B) that exist in non-syncable remote root H");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.menuGuid,
    children: [{
      // A is non-syncable remotely, but B doesn't exist remotely, so we'll
      // remove A from the merged structure, and move B to the menu.
      guid: "folderAAAAAA",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "A",
      children: [{
        guid: "bookmarkBBBB",
        title: "B",
        url: "http://example.com/b",
      }],
    }],
  });

  info("Insert non-syncable local root C and items (C > (D > E) F)");
  await insertLocalRoot({
    guid: "rootCCCCCCCC",
    title: "C",
  });
  await PlacesUtils.bookmarks.insertTree({
    guid: "rootCCCCCCCC",
    children: [{
      guid: "folderDDDDDD",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "D",
      children: [{
        guid: "bookmarkEEEE",
        url: "http://example.com/e",
        title: "E",
      }],
    }, {
      guid: "bookmarkFFFF",
      url: "http://example.com/f",
      title: "F",
    }],
  });
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make remote changes");
  await storeRecords(buf, [{
    // H is a non-syncable root that only exists remotely.
    id: "rootHHHHHHHH",
    type: "folder",
    parentid: "places",
    title: "H",
    children: ["folderAAAAAA"],
  }, {
    // A is a folder with children that's non-syncable remotely, and syncable
    // locally. We should remove A and its descendants locally, since its parent
    // H is known to be non-syncable remotely.
    id: "folderAAAAAA",
    parentid: "rootHHHHHHHH",
    type: "folder",
    title: "A",
    children: ["bookmarkFFFF", "bookmarkIIII"],
  }, {
    // F exists in two different non-syncable folders: C locally, and A
    // remotely.
    id: "bookmarkFFFF",
    parentid: "folderAAAAAA",
    type: "bookmark",
    title: "F",
    bmkUri: "http://example.com/f",
  }, {
    id: "bookmarkIIII",
    parentid: "folderAAAAAA",
    type: "query",
    title: "I",
    bmkUri: "http://example.com/i",
  }, {
    // The complete left pane root. We should remove all left pane queries
    // locally, even though they're syncable, since the left pane root is
    // known to be non-syncable.
    id: "folderLEFTPR",
    type: "folder",
    parentid: "places",
    title: "",
    children: ["folderLEFTPQ", "folderLEFTPF"],
  }, {
    id: "folderLEFTPQ",
    parentid: "folderLEFTPR",
    type: "query",
    title: "Some query",
    bmkUri: "place:folder=SOMETHING",
  }, {
    id: "folderLEFTPF",
    parentid: "folderLEFTPR",
    type: "folder",
    title: "All Bookmarks",
    children: ["folderLEFTPC"],
  }, {
    id: "folderLEFTPC",
    parentid: "folderLEFTPF",
    type: "query",
    title: "A query under 'All Bookmarks'",
    bmkUri: "place:folder=SOMETHING_ELSE",
  }, {
    // D, J, and G are syncable remotely, but D is non-syncable locally. Since
    // J and G don't exist locally, and are syncable remotely, we'll remove D
    // from the merged structure, and move J and G to unfiled.
    id: "unfiled",
    parentid: "places",
    type: "folder",
    children: ["folderDDDDDD", "bookmarkGGGG"],
  }, {
    id: "folderDDDDDD",
    parentid: "unfiled",
    type: "folder",
    title: "D",
    children: ["bookmarkJJJJ"],
  }, {
    id: "bookmarkJJJJ",
    parentid: "folderDDDDDD",
    type: "bookmark",
    title: "J",
    bmkUri: "http://example.com/j",
  }, {
    id: "bookmarkGGGG",
    parentid: "unfiled",
    type: "bookmark",
    title: "G",
    bmkUri: "http://example.com/g",
  }]);

  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let datesAdded = await promiseManyDatesAdded([PlacesUtils.bookmarks.menuGuid,
    PlacesUtils.bookmarks.unfiledGuid, "bookmarkBBBB", "bookmarkJJJJ"]);
  deepEqual(changesToUpload, {
    folderAAAAAA: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderAAAAAA",
        deleted: true,
      },
    },
    folderDDDDDD: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderDDDDDD",
        deleted: true,
      },
    },
    folderLEFTPQ: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderLEFTPQ",
        deleted: true,
      },
    },
    folderLEFTPC: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderLEFTPC",
        deleted: true,
      },
    },
    folderLEFTPR: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderLEFTPR",
        deleted: true,
      },
    },
    folderLEFTPF: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "folderLEFTPF",
        deleted: true,
      },
    },
    rootHHHHHHHH: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "rootHHHHHHHH",
        deleted: true,
      },
    },
    bookmarkFFFF: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkFFFF",
        deleted: true,
      },
    },
    bookmarkIIII: {
      tombstone: true,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkIIII",
        deleted: true,
      },
    },
    bookmarkBBBB: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkBBBB",
        type: "bookmark",
        parentid: "menu",
        hasDupe: true,
        parentName: BookmarksMenuTitle,
        dateAdded: datesAdded.get("bookmarkBBBB"),
        bmkUri: "http://example.com/b",
        title: "B",
      },
    },
    bookmarkJJJJ: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkJJJJ",
        type: "bookmark",
        parentid: "unfiled",
        hasDupe: true,
        parentName: UnfiledBookmarksTitle,
        dateAdded: undefined,
        bmkUri: "http://example.com/j",
        title: "J",
      },
    },
    menu: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "menu",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.menuGuid),
        title: BookmarksMenuTitle,
        children: ["bookmarkBBBB"],
      },
    },
    unfiled: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "unfiled",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.unfiledGuid),
        title: UnfiledBookmarksTitle,
        children: ["bookmarkJJJJ", "bookmarkGGGG"],
      },
    },
  }, "Should upload new structure and tombstones for non-syncable items");

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "B",
        url: "http://example.com/b",
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
      children: [{
        guid: "bookmarkJJJJ",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "J",
        url: "http://example.com/j",
      }, {
        guid: "bookmarkGGGG",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 1,
        title: "G",
        url: "http://example.com/g",
      }],
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should exclude non-syncable items from new local structure");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

// See what happens when a left-pane root and a left-pane query are on the server
add_task(async function test_left_pane_root() {
  let buf = await openMirror("lpr");

  let initialTree = await fetchLocalTree(PlacesUtils.bookmarks.rootGuid);

  // This test is expected to not touch bookmarks at all, and if it did
  // happen to create a new item that's not under our syncable roots, then
  // just checking the result of fetchLocalTree wouldn't pick that up - so
  // as an additional safety check, count how many bookmark rows exist.
  let numRows = await getCountOfBookmarkRows(buf.db);

  // Add a left pane root, a left-pane query and a left-pane folder to the
  // mirror, all correctly parented.
  // Because we can determine this is a complete tree that's outside our
  // syncable trees, we expect none of them to be applied.
  await storeRecords(buf, shuffle([{
    id: "folderLEFTPR",
    type: "folder",
    parentid: "places",
    title: "",
    children: ["folderLEFTPQ", "folderLEFTPF"],
  }, {
    id: "folderLEFTPQ",
    type: "query",
    parentid: "folderLEFTPR",
    title: "Some query",
    bmkUri: "place:folder=SOMETHING",
  }, {
    id: "folderLEFTPF",
    type: "folder",
    parentid: "folderLEFTPR",
    title: "All Bookmarks",
    children: ["folderLEFTPC"],
  }, {
    id: "folderLEFTPC",
    type: "query",
    parentid: "folderLEFTPF",
    title: "A query under 'All Bookmarks'",
    bmkUri: "place:folder=SOMETHING_ELSE",
  }], { needsMerge: true }));

  await buf.apply();

  // should have ignored everything.
  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, initialTree);

  // and a check we didn't write *any* items to the places database, even
  // outside of our user roots.
  Assert.equal(await getCountOfBookmarkRows(buf.db), numRows);

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

// See what happens when a left-pane query (without the left-pane root) is on
// the server
add_task(async function test_left_pane_query() {
  let buf = await openMirror("lpq");

  let initialTree = await fetchLocalTree(PlacesUtils.bookmarks.rootGuid);

  // This test is expected to not touch bookmarks at all, and if it did
  // happen to create a new item that's not under our syncable roots, then
  // just checking the result of fetchLocalTree wouldn't pick that up - so
  // as an additional safety check, count how many bookmark rows exist.
  let numRows = await getCountOfBookmarkRows(buf.db);

  // Add the left pane root and left-pane folders to the mirror, correctly parented.
  // We should not apply it because we made a policy decision to not apply
  // orphaned queries (bug 1433182)
  await storeRecords(buf, [{
    id: "folderLEFTPQ",
    type: "query",
    parentid: "folderLEFTPR",
    title: "Some query",
    bmkUri: "place:folder=SOMETHING",
  }], { needsMerge: true });

  await buf.apply();

  // should have ignored everything.
  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, initialTree);

  // and further check we didn't apply it as mis-rooted.
  Assert.equal(await getCountOfBookmarkRows(buf.db), numRows);

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_partial_cycle() {
  let buf = await openMirror("partial_cycle");

  info("Set up mirror: Menu > A > B > C");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.menuGuid,
    children: [{
      guid: "folderAAAAAA",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title: "A",
      children: [{
        guid: "folderBBBBBB",
        type: PlacesUtils.bookmarks.TYPE_FOLDER,
        title: "B",
        children: [{
          guid: "bookmarkCCCC",
          url: "http://example.com/c",
          title: "C",
        }],
      }],
    }],
  });
  await storeRecords(buf, shuffle([{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["folderAAAAAA"],
  }, {
    id: "folderAAAAAA",
    parentid: "menu",
    type: "folder",
    title: "A",
    children: ["folderBBBBBB"],
  }, {
    id: "folderBBBBBB",
    parentid: "folderAAAAAA",
    type: "folder",
    title: "B",
    children: ["bookmarkCCCC"],
  }, {
    id: "bookmarkCCCC",
    parentid: "folderBBBBBB",
    type: "bookmark",
    title: "C",
    bmkUri: "http://example.com/c",
  }]), { needsMerge: false });
  await PlacesTestUtils.markBookmarksAsSynced();

  // Try to create a cycle: move A into B, and B into the menu, but don't upload
  // a record for the menu.
  info("Make remote changes: A > C");
  await storeRecords(buf, [{
    id: "folderAAAAAA",
    parentid: "menu",
    type: "folder",
    title: "A (remote)",
    children: ["bookmarkCCCC"],
  }, {
    id: "folderBBBBBB",
    parentid: "folderAAAAAA",
    type: "folder",
    title: "B (remote)",
    children: ["folderAAAAAA"],
  }]);

  await Assert.rejects(buf.apply(), /Item folderBBBBBB can't contain itself/,
    "Should abort merge if remote tree parents form `parentid` cycle");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_complete_cycle() {
  let buf = await openMirror("complete_cycle");

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  // This test is order-dependent. We shouldn't recurse infinitely, but,
  // depending on the order of the records, we might ignore the circular
  // subtree because there's nothing linking it back to the rest of the
  // tree.
  info("Make remote changes: Menu > A > B > C > A");
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["folderAAAAAA"],
  }, {
    id: "folderAAAAAA",
    parentid: "menu",
    type: "folder",
    title: "A",
    children: ["folderBBBBBB"],
  }, {
    id: "folderBBBBBB",
    parentid: "folderAAAAAA",
    type: "folder",
    title: "B",
    children: ["folderCCCCCC"],
  }, {
    id: "folderCCCCCC",
    parentid: "folderBBBBBB",
    type: "folder",
    title: "C",
    children: ["folderDDDDDD"],
  }, {
    id: "folderDDDDDD",
    parentid: "folderCCCCCC",
    type: "folder",
    title: "D",
    children: ["folderAAAAAA"],
  }]);

  await Assert.rejects(buf.apply(), /Item folderAAAAAA can't contain itself/,
    "Should abort merge if remote tree parents form cycle through `children`");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_invalid_guid() {
  let now = new Date();

  let buf = await openMirror("invalid_guid");

  info("Set up empty mirror");
  await PlacesTestUtils.markBookmarksAsSynced();

  info("Make remote changes");
  await storeRecords(buf, [{
    id: "menu",
    parentid: "places",
    type: "folder",
    children: ["bookmarkAAAA", "bad!guid~", "bookmarkBBBB"],
  }, {
    id: "bookmarkAAAA",
    parentid: "menu",
    type: "bookmark",
    title: "A",
    bmkUri: "http://example.com/a",
  }, {
    id: "bad!guid~",
    parentid: "menu",
    type: "bookmark",
    title: "C",
    bmkUri: "http://example.com/c",
    dateAdded: now.getTime(),
  }, {
    id: "bookmarkBBBB",
    parentid: "menu",
    type: "bookmark",
    title: "B",
    bmkUri: "http://example.com/b",
  }]);

  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let datesAdded = await promiseManyDatesAdded([PlacesUtils.bookmarks.menuGuid]);

  let recordIdsToUpload = Object.keys(changesToUpload);
  let newGuid = recordIdsToUpload.find(recordId =>
    !["bad!guid~", "menu"].includes(recordId));

  equal(recordIdsToUpload.length, 3,
    "Should reupload menu, C, and tombstone for bad GUID");

  deepEqual(changesToUpload["bad!guid~"], {
    tombstone: true,
    counter: 1,
    synced: false,
    cleartext: {
      id: "bad!guid~",
      deleted: true,
    },
  }, "Should upload tombstone for C's invalid GUID");

  deepEqual(changesToUpload[newGuid], {
    tombstone: false,
    counter: 1,
    synced: false,
    cleartext: {
      id: newGuid,
      type: "bookmark",
      parentid: "menu",
      hasDupe: true,
      parentName: BookmarksMenuTitle,
      dateAdded: now.getTime(),
      bmkUri: "http://example.com/c",
      title: "C",
    },
  }, "Should reupload C with new GUID");

  deepEqual(changesToUpload.menu, {
    tombstone: false,
    counter: 1,
    synced: false,
    cleartext: {
      id: "menu",
      type: "folder",
      parentid: "places",
      hasDupe: true,
      parentName: "",
      dateAdded: datesAdded.get(PlacesUtils.bookmarks.menuGuid),
      title: BookmarksMenuTitle,
      children: ["bookmarkAAAA", newGuid, "bookmarkBBBB"],
    },
  }, "Should reupload menu with new child GUID for C");

  deepEqual(await buf.fetchRemoteOrphans(), {
    missingChildren: [],
    missingParents: [],
    parentsWithGaps: [],
  }, "Should not report problems");

  await assertLocalTree(PlacesUtils.bookmarks.menuGuid, {
    guid: PlacesUtils.bookmarks.menuGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: BookmarksMenuTitle,
    children: [{
      guid: "bookmarkAAAA",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 0,
      title: "A",
      url: "http://example.com/a",
    }, {
      guid: newGuid,
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 1,
      title: "C",
      url: "http://example.com/c",
    }, {
      guid: "bookmarkBBBB",
      type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
      index: 2,
      title: "B",
      url: "http://example.com/b",
    }],
  });

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});

add_task(async function test_sync_status_mismatches() {
  let dateAdded = new Date();

  let mergeTelemetryEvents = [];
  let buf = await openMirror("sync_status_mismatches", {
    recordTelemetryEvent(object, method, value, extra) {
      equal(object, "mirror", "Wrong object for telemetry event");
      if (method == "merge") {
        mergeTelemetryEvents.push({ value, extra });
      }
    },
  });

  info("Ensure mirror is up-to-date with Places");
  let initialChangesToUpload = await buf.apply();

  deepEqual(Object.keys(initialChangesToUpload).sort(),
    ["menu", "mobile", "toolbar", "unfiled"],
    "Should upload roots on first merge");

  await storeChangesInMirror(buf, initialChangesToUpload);

  deepEqual(await buf.fetchSyncStatusMismatches(), {
    missingLocal: [],
    missingRemote: [],
    wrongSyncStatus: [],
  }, "Should not report mismatches after first merge");

  info("Make local changes");
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.menuGuid,
    source: PlacesUtils.bookmarks.SOURCES.SYNC,
    children: [{
      // A is NORMAL in Places, but doesn't exist in the mirror.
      guid: "bookmarkAAAA",
      url: "http://example.com/a",
      title: "A",
      dateAdded,
    }],
  });
  await PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.unfiledGuid,
    children: [{
      // B is NEW in Places and exists in the mirror.
      guid: "bookmarkBBBB",
      url: "http://example.com/b",
      title: "B",
      dateAdded,
    }],
  });

  info("Make remote changes");
  await storeRecords(buf, [{
    id: "unfiled",
    parentid: "places",
    type: "folder",
    children: ["bookmarkBBBB"],
  }, {
    id: "toolbar",
    parentid: "places",
    type: "folder",
    children: ["bookmarkCCCC"],
  }, {
    id: "bookmarkBBBB",
    parentid: "unfiled",
    type: "bookmark",
    bmkUri: "http://example.com/b",
    title: "B",
  }, {
    // C is flagged as merged in the mirror, but doesn't exist in Places.
    id: "bookmarkCCCC",
    parentid: "toolbar",
    type: "bookmark",
    bmkUri: "http://example.com/c",
    title: "C",
  }], { needsMerge: false });

  deepEqual(await buf.fetchSyncStatusMismatches(), {
    missingLocal: ["bookmarkCCCC"],
    missingRemote: ["bookmarkAAAA"],
    wrongSyncStatus: ["bookmarkBBBB"],
  }, "Should report sync status mismatches");

  info("Apply mirror");
  let changesToUpload = await buf.apply();
  deepEqual(await buf.fetchUnmergedGuids(), [], "Should merge all items");

  let datesAdded = await promiseManyDatesAdded([PlacesUtils.bookmarks.menuGuid,
    PlacesUtils.bookmarks.unfiledGuid]);
  deepEqual(changesToUpload, {
    bookmarkAAAA: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkAAAA",
        type: "bookmark",
        parentid: "menu",
        hasDupe: true,
        parentName: BookmarksMenuTitle,
        dateAdded: dateAdded.getTime(),
        bmkUri: "http://example.com/a",
        title: "A",
      },
    },
    bookmarkBBBB: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "bookmarkBBBB",
        type: "bookmark",
        parentid: "unfiled",
        hasDupe: true,
        parentName: UnfiledBookmarksTitle,
        dateAdded: dateAdded.getTime(),
        bmkUri: "http://example.com/b",
        title: "B",
      },
    },
    menu: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "menu",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.menuGuid),
        title: BookmarksMenuTitle,
        children: ["bookmarkAAAA"],
      },
    },
    unfiled: {
      tombstone: false,
      counter: 1,
      synced: false,
      cleartext: {
        id: "unfiled",
        type: "folder",
        parentid: "places",
        hasDupe: true,
        parentName: "",
        dateAdded: datesAdded.get(PlacesUtils.bookmarks.unfiledGuid),
        title: UnfiledBookmarksTitle,
        children: ["bookmarkBBBB"],
      },
    },
  }, "Should flag (A B) and their parents for upload");

  await assertLocalTree(PlacesUtils.bookmarks.rootGuid, {
    guid: PlacesUtils.bookmarks.rootGuid,
    type: PlacesUtils.bookmarks.TYPE_FOLDER,
    index: 0,
    title: "",
    children: [{
      guid: PlacesUtils.bookmarks.menuGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 0,
      title: BookmarksMenuTitle,
      children: [{
        guid: "bookmarkAAAA",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "A",
        url: "http://example.com/a",
      }],
    }, {
      guid: PlacesUtils.bookmarks.toolbarGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 1,
      title: BookmarksToolbarTitle,
      children: [{
        guid: "bookmarkCCCC",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "C",
        url: "http://example.com/c",
      }],
    }, {
      guid: PlacesUtils.bookmarks.unfiledGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 3,
      title: UnfiledBookmarksTitle,
      children: [{
        guid: "bookmarkBBBB",
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        index: 0,
        title: "B",
        url: "http://example.com/b",
      }],
    }, {
      guid: PlacesUtils.bookmarks.mobileGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      index: 4,
      title: MobileBookmarksTitle,
    }],
  }, "Should parent C correctly");

  await storeChangesInMirror(buf, changesToUpload);

  deepEqual(await buf.fetchSyncStatusMismatches(), {
    missingLocal: [],
    missingRemote: [],
    wrongSyncStatus: [],
  }, "Applying and storing new changes in mirror should fix inconsistencies");

  await buf.finalize();
  await PlacesUtils.bookmarks.eraseEverything();
  await PlacesSyncUtils.bookmarks.reset();
});
