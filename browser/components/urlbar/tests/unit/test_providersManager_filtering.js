/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_filtering() {
  let match = new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                               UrlbarUtils.RESULT_SOURCE.TABS,
                               { url: "http://mozilla.org/foo/" });
  let providerName = registerBasicTestProvider([match]);
  let context = createContext(undefined, {providers: [providerName]});
  let controller = new UrlbarController({
    browserWindow: {
      location: {
        href: AppConstants.BROWSER_CHROME_URL,
      },
    },
  });

  info("Disable the only available source, should get no matches");
  Services.prefs.setBoolPref("browser.urlbar.suggest.openpage", false);
  let promise = Promise.race([
    promiseControllerNotification(controller, "onQueryResults", false),
    promiseControllerNotification(controller, "onQueryFinished"),
  ]);
  await controller.startQuery(context);
  await promise;
  Services.prefs.clearUserPref("browser.urlbar.suggest.openpage");

  let matches = [
    match,
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                     UrlbarUtils.RESULT_SOURCE.HISTORY,
                     { url: "http://mozilla.org/foo/" }),
  ];
  providerName = registerBasicTestProvider(matches);
  context = createContext(undefined, {providers: [providerName]});

  info("Disable one of the sources, should get a single match");
  Services.prefs.setBoolPref("browser.urlbar.suggest.history", false);
  promise = Promise.all([
    promiseControllerNotification(controller, "onQueryResults"),
    promiseControllerNotification(controller, "onQueryFinished"),
  ]);
  await controller.startQuery(context, controller);
  await promise;
  Assert.deepEqual(context.results, [match]);
  Services.prefs.clearUserPref("browser.urlbar.suggest.history");

  info("Use a restriction character, should get a single match");
  context = createContext(`foo ${UrlbarTokenizer.RESTRICT.OPENPAGE}`,
                          {providers: [providerName]});
  promise = Promise.all([
    promiseControllerNotification(controller, "onQueryResults"),
    promiseControllerNotification(controller, "onQueryFinished"),
  ]);
  await controller.startQuery(context, controller);
  await promise;
  Assert.deepEqual(context.results, [match]);
});

add_task(async function test_filter_javascript() {
  let controller = new UrlbarController({
    browserWindow: {
      location: {
        href: AppConstants.BROWSER_CHROME_URL,
      },
    },
  });
  let match = new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                               UrlbarUtils.RESULT_SOURCE.TABS,
                               { url: "http://mozilla.org/foo/" });
  let jsMatch = new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                                 UrlbarUtils.RESULT_SOURCE.HISTORY,
                                 { url: "javascript:foo" });
  let providerName = registerBasicTestProvider([match, jsMatch]);
  let context = createContext(undefined, {providers: [providerName]});

  info("By default javascript should be filtered out");
  let promise = promiseControllerNotification(controller, "onQueryResults");
  await controller.startQuery(context, controller);
  await promise;
  Assert.deepEqual(context.results, [match]);

  info("Except when the user explicitly starts the search with javascript:");
  context = createContext(`javascript: ${UrlbarTokenizer.RESTRICT.HISTORY}`,
                          {providers: [providerName]});
  promise = promiseControllerNotification(controller, "onQueryResults");
  await controller.startQuery(context, controller);
  await promise;
  Assert.deepEqual(context.results, [jsMatch]);

  info("Disable javascript filtering");
  Services.prefs.setBoolPref("browser.urlbar.filter.javascript", false);
  context = createContext(undefined, {providers: [providerName]});
  promise = promiseControllerNotification(controller, "onQueryResults");
  await controller.startQuery(context, controller);
  await promise;
  Assert.deepEqual(context.results, [match, jsMatch]);
  Services.prefs.clearUserPref("browser.urlbar.filter.javascript");
});

add_task(async function test_filter_sources() {
  let controller = new UrlbarController({
    browserWindow: {
      location: {
        href: AppConstants.BROWSER_CHROME_URL,
      },
    },
  });

  let goodMatches = [
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                     UrlbarUtils.RESULT_SOURCE.TABS,
                     { url: "http://mozilla.org/foo/" }),
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.URL,
                     UrlbarUtils.RESULT_SOURCE.HISTORY,
                     { url: "http://mozilla.org/foo/" }),
  ];
  /**
   * A test provider that should be invoked.
   */
  class TestProvider extends UrlbarProvider {
    get name() {
      return "GoodProvider";
    }
    get type() {
      return UrlbarUtils.PROVIDER_TYPE.PROFILE;
    }
    get sources() {
      return [
        UrlbarUtils.RESULT_SOURCE.TABS,
        UrlbarUtils.RESULT_SOURCE.HISTORY,
      ];
    }
    async startQuery(context, add) {
      Assert.ok(true, "expected provider was invoked");
      for (const match of goodMatches) {
        add(this, match);
      }
    }
    cancelQuery(context) {}
  }
  UrlbarProvidersManager.registerProvider(new TestProvider());

  let badMatches = [
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.URL,
                     UrlbarUtils.RESULT_SOURCE.BOOKMARKS,
                     { url: "http://mozilla.org/foo/" }),
  ];

  /**
   * A test provider that should not be invoked.
   */
  class NoInvokeProvider extends UrlbarProvider {
    get name() {
      return "BadProvider";
    }
    get type() {
      return UrlbarUtils.PROVIDER_TYPE.PROFILE;
    }
    get sources() {
      return [UrlbarUtils.RESULT_SOURCE.BOOKMARKS];
    }
    async startQuery(context, add) {
      Assert.ok(false, "Provider should no be invoked");
      for (const match of badMatches) {
        add(this, match);
      }
    }
    cancelQuery(context) {}
  }

  UrlbarProvidersManager.registerProvider(new NoInvokeProvider());

  let context = createContext(undefined, {
    sources: [UrlbarUtils.RESULT_SOURCE.TABS],
    providers: ["GoodProvider", "BadProvider"],
  });

  info("Only tabs should be returned");
  let promise = promiseControllerNotification(controller, "onQueryResults");
  await controller.startQuery(context, controller);
  await promise;
  Assert.deepEqual(context.results.length, 1, "Should find only one match");
  Assert.deepEqual(context.results[0].source, UrlbarUtils.RESULT_SOURCE.TABS,
                   "Should find only a tab match");
});

add_task(async function test_nofilter_immediate() {
  // Checks that even if a provider returns a result that should be filtered out
  // it will still be invoked if it's of type immediate, and only the heuristic
  // result is returned.
  let controller = new UrlbarController({
    browserWindow: {
      location: {
        href: AppConstants.BROWSER_CHROME_URL,
      },
    },
  });

  let matches = [
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                     UrlbarUtils.RESULT_SOURCE.TABS,
                     { url: "http://mozilla.org/foo/" }),
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                     UrlbarUtils.RESULT_SOURCE.TABS,
                     { url: "http://mozilla.org/foo2/" }),
  ];
  matches[0].heuristic = true;

  /**
   * A test provider that should be invoked.
   */
  class TestProvider extends UrlbarProvider {
    get name() {
      return "GoodProvider";
    }
    get type() {
      return UrlbarUtils.PROVIDER_TYPE.IMMEDIATE;
    }
    get sources() {
      return [
        UrlbarUtils.RESULT_SOURCE.TABS,
      ];
    }
    async startQuery(context, add) {
      Assert.ok(true, "expected provider was invoked");
      for (let match of matches) {
        add(this, match);
      }
    }
    cancelQuery(context) {}
  }
  UrlbarProvidersManager.registerProvider(new TestProvider());

  let context = createContext(undefined, {
    sources: [UrlbarUtils.RESULT_SOURCE.SEARCH],
    providers: ["GoodProvider"],
  });
  // Disable search matches through prefs.
  Services.prefs.setBoolPref("browser.urlbar.suggest.openpage", false);

  info("Only 1 heuristic tab result should be returned");
  let promise = promiseControllerNotification(controller, "onQueryResults");
  await controller.startQuery(context, controller);
  await promise;
  Services.prefs.clearUserPref("browser.urlbar.suggest.openpage");
  Assert.deepEqual(context.results.length, 1, "Should find only one match");
  Assert.deepEqual(context.results[0].source, UrlbarUtils.RESULT_SOURCE.TABS,
                   "Should find only a tab match");
});

add_task(async function test_nofilter_restrict() {
  // Checks that even if a pref is disabled, we still return results on a
  // restriction token.
  let controller = new UrlbarController({
    browserWindow: {
      location: {
        href: AppConstants.BROWSER_CHROME_URL,
      },
    },
  });

  let matches = [
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.TAB_SWITCH,
                     UrlbarUtils.RESULT_SOURCE.TABS,
                     { url: "http://mozilla.org/foo_tab/" }),
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.URL,
                     UrlbarUtils.RESULT_SOURCE.BOOKMARKS,
                     { url: "http://mozilla.org/foo_bookmark/" }),
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.URL,
                     UrlbarUtils.RESULT_SOURCE.HISTORY,
                     { url: "http://mozilla.org/foo_history/" }),
    new UrlbarResult(UrlbarUtils.RESULT_TYPE.SEARCH,
                     UrlbarUtils.RESULT_SOURCE.SEARCH,
                     { engine: "noengine" }),
  ];

  /**
   * A test provider.
   */
  class TestProvider extends UrlbarProvider {
    get name() {
      return "MyProvider";
    }
    get type() {
      return UrlbarUtils.PROVIDER_TYPE.IMMEDIATE;
    }
    get sources() {
      return [
        UrlbarUtils.RESULT_SOURCE.TABS,
        UrlbarUtils.RESULT_SOURCE.BOOKMARKS,
        UrlbarUtils.RESULT_SOURCE.HISTORY,
        UrlbarUtils.RESULT_SOURCE.SEARCH,
      ];
    }
    async startQuery(context, add) {
      Assert.ok(true, "expected provider was invoked");
      for (let match of matches) {
        add(this, match);
      }
    }
    cancelQuery(context) {}
  }
  UrlbarProvidersManager.registerProvider(new TestProvider());

  let typeToPropertiesMap = new Map([
    ["HISTORY", {source: "HISTORY", pref: "history"}],
    ["BOOKMARK", {source: "BOOKMARKS", pref: "bookmark"}],
    ["OPENPAGE", {source: "TABS", pref: "openpage"}],
    ["SEARCH", {source: "SEARCH", pref: "searches"}],
  ]);
  for (let [type, token] of Object.entries(UrlbarTokenizer.RESTRICT)) {
    let properties = typeToPropertiesMap.get(type);
    if (!properties) {
      continue;
    }
    info("Restricting on " + type);
    let context = createContext(token + " foo", {
      providers: ["MyProvider"],
    });
    // Disable the corresponding pref.
    const pref = "browser.urlbar.suggest." + properties.pref;
    info("Disabling " + pref);
    Services.prefs.setBoolPref(pref, false);
    await controller.startQuery(context, controller);
    Assert.equal(context.results.length, 1, "Should find one result");
    Assert.equal(context.results[0].source,
                 UrlbarUtils.RESULT_SOURCE[properties.source],
                 "Check result source");
    Services.prefs.clearUserPref(pref);
  }
});
