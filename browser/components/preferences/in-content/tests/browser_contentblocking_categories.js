/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

/* eslint-env webextensions */

ChromeUtils.defineModuleGetter(this, "Preferences",
                               "resource://gre/modules/Preferences.jsm");

const TP_PREF = "privacy.trackingprotection.enabled";
const TP_PBM_PREF = "privacy.trackingprotection.pbmode.enabled";
const NCB_PREF = "network.cookie.cookieBehavior";
const CAT_PREF = "browser.contentblocking.category";
const FP_PREF = "privacy.trackingprotection.fingerprinting.enabled";
const CM_PREF = "privacy.trackingprotection.cryptomining.enabled";
const STRICT_DEF_PREF = "browser.contentblocking.features.strict";
const STANDARD_DEF_PREF = "browser.contentblocking.features.standard";

// Tests that the content blocking standard category definition changes the behavior
// of the standard category pref and all prefs it controls.
// Changing the definition does not remove the user from the category.
add_task(async function testContentBlockingStandardDefinition() {
  let defaults = Services.prefs.getDefaultBranch("");
  let originalStandardPref = defaults.getStringPref(STANDARD_DEF_PREF);
  defaults.setStringPref(STANDARD_DEF_PREF, "tp,tpPrivate,fp,cm,cookieBehavior4");
  is(Services.prefs.getStringPref(CAT_PREF), "standard", `${CAT_PREF} starts on standard`);

  ok(!Services.prefs.prefHasUserValue(STANDARD_DEF_PREF), `We changed the default value of ${STANDARD_DEF_PREF}`);
  is(Services.prefs.getStringPref(STANDARD_DEF_PREF), "tp,tpPrivate,fp,cm,cookieBehavior4", "The pref changed to what we set.");

  is(Services.prefs.getBoolPref(TP_PREF), true, `${TP_PREF} pref has been set to true`);
  is(Services.prefs.getBoolPref(TP_PBM_PREF), true, `${TP_PBM_PREF} pref has been set to true`);
  is(Services.prefs.getBoolPref(FP_PREF), true, `${CM_PREF} pref has been set to true`);
  is(Services.prefs.getBoolPref(CM_PREF), true, `${CM_PREF} pref has been set to true`);
  is(Services.prefs.getIntPref(NCB_PREF), Ci.nsICookieService.BEHAVIOR_REJECT_TRACKER, `${NCB_PREF} has been set to BEHAVIOR_REJECT_TRACKER`);

  // Note, if a pref is not listed it will use the default value, however this is only meant as a
  // backup if a mistake is made. The UI will not respond correctly.
  defaults.setStringPref(STANDARD_DEF_PREF, "");
  ok(!Services.prefs.prefHasUserValue(TP_PREF), `${TP_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(TP_PBM_PREF), `${TP_PBM_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(FP_PREF), `${FP_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(CM_PREF), `${CM_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(NCB_PREF), `${NCB_PREF} pref has the default value`);

  defaults.setStringPref(STANDARD_DEF_PREF, "-tpPrivate,-fp,-cm,-tp,cookieBehavior2");
  is(Services.prefs.getBoolPref(TP_PREF), false, `${TP_PREF} pref has been set to false`);
  is(Services.prefs.getBoolPref(TP_PBM_PREF), false, `${TP_PBM_PREF} pref has been set to false`);
  is(Services.prefs.getBoolPref(FP_PREF), false, `${FP_PREF} pref has been set to false`);
  is(Services.prefs.getBoolPref(CM_PREF), false, `${CM_PREF} pref has been set to false`);
  is(Services.prefs.getIntPref(NCB_PREF), Ci.nsICookieService.BEHAVIOR_REJECT, `${NCB_PREF} has been set to BEHAVIOR_REJECT_TRACKER`);

  // cleanup
  defaults.setStringPref(STANDARD_DEF_PREF, originalStandardPref);
});

// Tests that the content blocking strict category definition changes the behavior
// of the strict category pref and all prefs it controls.
// Changing the definition does not remove the user from the category.
add_task(async function testContentBlockingStrictDefinition() {
  let defaults = Services.prefs.getDefaultBranch("");
  let originalStrictPref = defaults.getStringPref(STRICT_DEF_PREF);
  defaults.setStringPref(STRICT_DEF_PREF, "tp,tpPrivate,fp,cm,cookieBehavior0");
  Services.prefs.setStringPref(CAT_PREF, "strict");
  is(Services.prefs.getStringPref(CAT_PREF), "strict", `${CAT_PREF} has changed to strict`);

  ok(!Services.prefs.prefHasUserValue(STRICT_DEF_PREF), `We changed the default value of ${STRICT_DEF_PREF}`);
  is(Services.prefs.getStringPref(STRICT_DEF_PREF), "tp,tpPrivate,fp,cm,cookieBehavior0", `${STRICT_DEF_PREF} changed to what we set.`);

  is(Services.prefs.getBoolPref(TP_PREF), true, `${TP_PREF} pref has been set to true`);
  is(Services.prefs.getBoolPref(TP_PBM_PREF), true, `${TP_PBM_PREF} pref has been set to true`);
  is(Services.prefs.getBoolPref(FP_PREF), true, `${CM_PREF} pref has been set to true`);
  is(Services.prefs.getBoolPref(CM_PREF), true, `${CM_PREF} pref has been set to true`);
  is(Services.prefs.getIntPref(NCB_PREF), Ci.nsICookieService.BEHAVIOR_ACCEPT, `${NCB_PREF} has been set to BEHAVIOR_REJECT_TRACKER`);

  // Note, if a pref is not listed it will use the default value, however this is only meant as a
  // backup if a mistake is made. The UI will not respond correctly.
  defaults.setStringPref(STRICT_DEF_PREF, "");
  ok(!Services.prefs.prefHasUserValue(TP_PREF), `${TP_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(TP_PBM_PREF), `${TP_PBM_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(FP_PREF), `${FP_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(CM_PREF), `${CM_PREF} pref has the default value`);
  ok(!Services.prefs.prefHasUserValue(NCB_PREF), `${NCB_PREF} pref has the default value`);

  defaults.setStringPref(STRICT_DEF_PREF, "-tpPrivate,-fp,-cm,-tp,cookieBehavior3");
  is(Services.prefs.getBoolPref(TP_PREF), false, `${TP_PREF} pref has been set to false`);
  is(Services.prefs.getBoolPref(TP_PBM_PREF), false, `${TP_PBM_PREF} pref has been set to false`);
  is(Services.prefs.getBoolPref(FP_PREF), false, `${FP_PREF} pref has been set to false`);
  is(Services.prefs.getBoolPref(CM_PREF), false, `${CM_PREF} pref has been set to false`);
  is(Services.prefs.getIntPref(NCB_PREF), Ci.nsICookieService.BEHAVIOR_LIMIT_FOREIGN, `${NCB_PREF} has been set to BEHAVIOR_REJECT_TRACKER`);

  // cleanup
  defaults.setStringPref(STRICT_DEF_PREF, originalStrictPref);
  Services.prefs.setStringPref(CAT_PREF, "standard");
});
