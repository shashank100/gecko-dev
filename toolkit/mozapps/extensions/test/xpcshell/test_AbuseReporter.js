/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/
 */

const {
  AbuseReporter,
  AbuseReportError,
} = ChromeUtils.import("resource://gre/modules/AbuseReporter.jsm");

const {ClientID} = ChromeUtils.import("resource://gre/modules/ClientID.jsm");
const {
  TelemetryController,
} = ChromeUtils.import("resource://gre/modules/TelemetryController.jsm");
const {
  TelemetryTestUtils,
} = ChromeUtils.import("resource://testing-common/TelemetryTestUtils.jsm");

const APPNAME = "XPCShell";
const APPVERSION = "1";
const ADDON_ID = "test-addon@tests.mozilla.org";
const ADDON_ID2 = "test-addon2@tests.mozilla.org";
const FAKE_INSTALL_INFO = {source: "fake-install-method"};
const REPORT_OPTIONS = {reportEntryPoint: "menu"};
const TELEMETRY_EVENTS_FILTERS = {category: "addonsManager", method: "report"};

createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "1", "49");

let apiRequestHandler;
const server = createHttpServer({hosts: ["test.addons.org"]});
server.registerPathHandler("/api/report/", (request, response) => {
  const stream = request.bodyInputStream;
  const buffer = NetUtil.readInputStream(stream, stream.available());
  const data = new TextDecoder().decode(buffer);
  apiRequestHandler({data, request, response});
});

function handleSubmitRequest({request, response}) {
  response.setStatusLine(request.httpVersion, 200, "OK");
  response.setHeader("Content-Type", "application/json", false);
  response.write("{}");
}

async function clearAbuseReportState() {
  // Clear the timestamp of the last submission.
  AbuseReporter._lastReportTimestamp = null;
}

async function installTestExtension(overrideOptions = {}) {
  const extOptions = {
    manifest: {
      applications: {gecko: {id: ADDON_ID}},
      name: "Test Extension",
    },
    useAddonManager: "permanent",
    amInstallTelemetryInfo: FAKE_INSTALL_INFO,
    ...overrideOptions,
  };

  const extension = ExtensionTestUtils.loadExtension(extOptions);
  await extension.startup();

  const addon = await AddonManager.getAddonByID(ADDON_ID);

  return {extension, addon};
}

async function assertRejectsAbuseReportError(promise, errorType) {
  await Assert.rejects(promise, error => {
    ok(error instanceof AbuseReportError);
    return error.errorType === errorType;
  });
}

async function assertBaseReportData({reportData, addon}) {
  // Report properties related to addon metadata.
  equal(reportData.addon, ADDON_ID, "Got expected 'addon'");
  equal(reportData.addon_version, addon.version, "Got expected 'addon_version'");
  equal(reportData.install_date, addon.installDate.toISOString(),
        "Got expected 'install_date' in ISO format");
  equal(reportData.addon_install_origin, addon.sourceURI.spec,
        "Got expected 'addon_install_origin'");
  equal(reportData.addon_install_method, "other",
        "Got expected 'addon_install_method'");
  equal(reportData.addon_signature, "privileged", "Got expected 'addon_signature'");

  // Report properties related to the environment.
  equal(reportData.client_id, await ClientID.getClientIdHash(),
        "Got the expected 'client_id'");
  equal(reportData.app, APPNAME.toLowerCase(), "Got expected 'app'");
  equal(reportData.appversion, APPVERSION, "Got expected 'appversion'");
  equal(reportData.lang, Services.locale.appLocaleAsLangTag, "Got expected 'lang'");
  equal(reportData.operating_system, AppConstants.platform, "Got expected 'operating_system'");
  equal(reportData.operating_system_version, Services.sysinfo.getProperty("version"),
        "Got expected 'operating_system_version'");
}

add_task(async function test_setup() {
  Services.prefs.setCharPref("extensions.abuseReport.url", "http://test.addons.org/api/report/");
  await promiseStartupManager();
  // Telemetry test setup needed to ensure that the builtin events are defined
  // and they can be collected and verified.
  await TelemetryController.testSetup();

  // This is actually only needed on Android, because it does not properly support unified telemetry
  // and so, if not enabled explicitly here, it would make these tests to fail when running on a
  // non-Nightly build.
  const oldCanRecordBase = Services.telemetry.canRecordBase;
  Services.telemetry.canRecordBase = true;
  registerCleanupFunction(() => {
    Services.telemetry.canRecordBase = oldCanRecordBase;
  });
});

add_task(async function test_addon_report_data() {
  info("Verify report property for a privileged extension");
  const {addon, extension} = await installTestExtension();
  const data = await AbuseReporter.getReportData(addon);
  await assertBaseReportData({reportData: data, addon});
  await extension.unload();

  info("Verify 'addon_signature' report property for non privileged extension");
  AddonTestUtils.usePrivilegedSignatures = false;
  const {
    addon: addon2,
    extension: extension2,
  } = await installTestExtension();
  const data2 = await AbuseReporter.getReportData(addon2);
  equal(data2.addon_signature, "signed",
        "Got expected 'addon_signature' for non privileged extension");
  await extension2.unload();

  info("Verify 'addon_install_method' report property on temporary install");
  const {
    addon: addon3,
    extension: extension3,
  } = await installTestExtension({useAddonManager: "temporary"});
  const data3 = await AbuseReporter.getReportData(addon3);
  equal(data3.addon_install_method, "temporary_addon",
        "Got expected 'addon_install_method' on temporary install");
  await extension3.unload();
});

add_task(async function test_report_on_not_installed_addon() {
  Services.telemetry.clearEvents();

  await assertRejectsAbuseReportError(
    AbuseReporter.createAbuseReport(ADDON_ID, REPORT_OPTIONS),
    "ERROR_ADDON_NOTFOUND");

  TelemetryTestUtils.assertEvents([{
    object: REPORT_OPTIONS.reportEntryPoint,
    value: ADDON_ID,
    extra: {error_type: "ERROR_ADDON_NOTFOUND"},
  }], TELEMETRY_EVENTS_FILTERS);
});

// This tests verifies the mapping between the addon installTelemetryInfo
// values and the addon_install_method expected by the API endpoint.
add_task(async function test_addon_install_method_mapping() {
  async function assertAddonInstallMethod(amInstallTelemetryInfo, expected) {
    const {addon, extension} = await installTestExtension({amInstallTelemetryInfo});
    const {addon_install_method} = await AbuseReporter.getReportData(addon);
    equal(addon_install_method, expected,
          `Got the expected addon_install_method for ${JSON.stringify(amInstallTelemetryInfo)}`);
    await extension.unload();
  }

  // Array of [ expected, amInstallTelemetryInfo ]
  const TEST_CASES = [
    ["amwebapi", {source: "amo", method: "amWebAPI"}],
    ["amwebapi", {source: "disco", method: "amWebAPI"}],
    ["distribution", {source: "distribution"}],
    ["drag_and_drop", {source: "about:addons", method: "drag-and-drop"}],
    ["enterprise_policy", {source: "enterprise-policy"}],
    ["file_uri", {source: "file-uri"}],
    ["install_from_file", {source: "about:addons", method: "install-from-file"}],
    ["installtrigger", {source: "test-host", method: "installTrigger"}],
    ["link", {source: "unknown", method: "link"}],
    ["management_webext_api", {source: "extension", method: "management-webext-api"}],
    ["sideload", {source: "sideload"}],
    ["sync", {source: "sync"}],
    ["system_addon", {source: "system-addon"}],
    ["temporary_addon", {source: "temporary-addon"}],
    ["other", {source: "internal"}],
    ["other", {source: "about:debugging"}],
    ["other", {source: "webide"}],
  ];

  for (const [expected, telemetryInfo] of TEST_CASES) {
    await assertAddonInstallMethod(telemetryInfo, expected);
  }
});

add_task(async function test_report_create_and_submit() {
  Services.telemetry.clearEvents();

  // Override the test api server request handler, to be able to
  // intercept the submittions to the test api server.
  let reportSubmitted;
  apiRequestHandler = ({data, request, response}) => {
    reportSubmitted = JSON.parse(data);
    handleSubmitRequest({request, response});
  };

  const {addon, extension} = await installTestExtension();

  const reportEntryPoint = "menu";
  const report = await AbuseReporter.createAbuseReport(ADDON_ID, {reportEntryPoint});

  equal(report.addon, addon, "Got the expected addon property");
  equal(report.reportEntryPoint, reportEntryPoint, "Got the expected reportEntryPoint");

  const baseReportData = await AbuseReporter.getReportData(addon);
  const reportProperties = {
    message: "test message",
    reason: "test-reason",
  };

  info("Submitting report");
  await report.submit(reportProperties);

  const expectedEntries = Object.entries({
    report_entry_point: reportEntryPoint,
    ...baseReportData,
    ...reportProperties,
  });

  for (const [expectedKey, expectedValue] of expectedEntries) {
    equal(reportSubmitted[expectedKey], expectedValue,
          `Got the expected submitted value for "${expectedKey}"`);
  }

  TelemetryTestUtils.assertEvents([{
    object: reportEntryPoint,
    value: ADDON_ID,
    extra: {addon_type: "extension"},
  }], TELEMETRY_EVENTS_FILTERS);

  await extension.unload();
});

add_task(async function test_error_recent_submit() {
  Services.telemetry.clearEvents();
  await clearAbuseReportState();

  let reportSubmitted;
  apiRequestHandler = ({data, request, response}) => {
    reportSubmitted = JSON.parse(data);
    handleSubmitRequest({request, response});
  };

  const {extension} = await installTestExtension();
  const report = await AbuseReporter.createAbuseReport(ADDON_ID, {
    reportEntryPoint: "uninstall",
  });

  const {extension: extension2} = await installTestExtension({
    manifest: {
      applications: {gecko: {id: ADDON_ID2}},
      name: "Test Extension2",
    },
  });
  const report2 = await AbuseReporter.createAbuseReport(ADDON_ID2, REPORT_OPTIONS);

  // Submit the two reports in fast sequence.
  await report.submit({reason: "reason1"});
  await assertRejectsAbuseReportError(report2.submit({reason: "reason2"}),
                                      "ERROR_RECENT_SUBMIT");
  equal(reportSubmitted.reason, "reason1",
        "Server only received the data from the first submission");

  TelemetryTestUtils.assertEvents([
    {
      object: "uninstall",
      value: ADDON_ID,
      extra: {addon_type: "extension"},
    },
    {
      object: REPORT_OPTIONS.reportEntryPoint,
      value: ADDON_ID2,
      extra: {
        addon_type: "extension",
        error_type: "ERROR_RECENT_SUBMIT",
      },
    },
  ], TELEMETRY_EVENTS_FILTERS);

  await extension.unload();
  await extension2.unload();
});

add_task(async function test_submission_server_error() {
  const {extension} = await installTestExtension();

  async function testErrorCode(
    responseStatus, expectedErrorType, expectRequest = true
  ) {
    info(`Test expected AbuseReportError on response status "${responseStatus}"`);
    Services.telemetry.clearEvents();
    await clearAbuseReportState();

    let requestReceived = false;
    apiRequestHandler = ({request, response}) => {
      requestReceived = true;
      response.setStatusLine(request.httpVersion, responseStatus, "Error");
      response.write("");
    };

    const report = await AbuseReporter.createAbuseReport(ADDON_ID, REPORT_OPTIONS);
    const promiseSubmit = report.submit({reason: "a-reason"});
    if (typeof expectedErrorType === "string") {
      // Assert a specific AbuseReportError errorType.
      await assertRejectsAbuseReportError(promiseSubmit, expectedErrorType);
    } else {
      // Assert on a given Error class.
      await Assert.rejects(promiseSubmit, expectedErrorType);
    }
    equal(requestReceived, expectRequest,
          `${expectRequest ? "" : "Not "}received a request as expected`);

    TelemetryTestUtils.assertEvents([{
      object: REPORT_OPTIONS.reportEntryPoint,
      value: ADDON_ID,
      extra: {
        addon_type: "extension",
        error_type: typeof expectedErrorType === "string" ?
          expectedErrorType : "ERROR_UNKNOWN",
      },
    }], TELEMETRY_EVENTS_FILTERS);
  }

  await testErrorCode(500, "ERROR_SERVER");
  await testErrorCode(404, "ERROR_CLIENT");
  // Test response with unexpected status code.
  await testErrorCode(604, "ERROR_UNKNOWN");
  // Test response status 200 with invalid json data.
  await testErrorCode(200, /SyntaxError: JSON.parse/);

  // Test on invalid url.
  Services.prefs.setCharPref("extensions.abuseReport.url",
                             "invalid-protocol://abuse-report");
  await testErrorCode(200, "ERROR_NETWORK", false);

  await extension.unload();
});

add_task(async function set_test_abusereport_url() {
  Services.prefs.setCharPref("extensions.abuseReport.url",
                             "http://test.addons.org/api/report/");
});

add_task(async function test_submission_aborting() {
  Services.telemetry.clearEvents();
  await clearAbuseReportState();

  const {extension} = await installTestExtension();

  // override the api request handler with one that is never going to reply.
  let receivedRequestsCount = 0;
  let resolvePendingResponses;
  const waitToReply = new Promise(resolve => resolvePendingResponses = resolve);

  const onRequestReceived = new Promise(resolve => {
    apiRequestHandler = ({request, response}) => {
      response.processAsync();
      response.setStatusLine(request.httpVersion, 200, "OK");
      receivedRequestsCount++;
      resolve();

      // Keep the request pending until resolvePendingResponses have been
      // called.
      waitToReply.then(() => {
        response.finish();
      });
    };
  });

  const report = await AbuseReporter.createAbuseReport(ADDON_ID, REPORT_OPTIONS);
  const promiseResult = report.submit({reason: "a-reason"});

  await onRequestReceived;

  ok(receivedRequestsCount > 0, "Got the expected number of requests");
  ok(await Promise.race([promiseResult, Promise.resolve("pending")]) === "pending",
    "Submission fetch request should still be pending");

  report.abort();

  await assertRejectsAbuseReportError(promiseResult, "ERROR_ABORTED_SUBMIT");

  TelemetryTestUtils.assertEvents([{
    object: REPORT_OPTIONS.reportEntryPoint,
    value: ADDON_ID,
    extra: {addon_type: "extension", error_type: "ERROR_ABORTED_SUBMIT"},
  }], TELEMETRY_EVENTS_FILTERS);

  await extension.unload();

  // Unblock pending requests on the server request handler side, so that the
  // test file can shutdown (otherwise the test run will be stuck after this
  // task completed).
  resolvePendingResponses();
});
