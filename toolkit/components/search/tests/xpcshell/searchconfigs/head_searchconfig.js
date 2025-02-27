/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {XPCOMUtils} = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyModuleGetters(this, {
  AddonTestUtils: "resource://testing-common/AddonTestUtils.jsm",
  OS: "resource://gre/modules/osfile.jsm",
  SearchTestUtils: "resource://testing-common/SearchTestUtils.jsm",
  Services: "resource://gre/modules/Services.jsm",
});

const GLOBAL_SCOPE = this;

const URLTYPE_SUGGEST_JSON = "application/x-suggestions+json";
const URLTYPE_SEARCH_HTML  = "text/html";

/**
 * This class implements the test harness for search configuration tests.
 * These tests are designed to ensure that the correct search engines are
 * loaded for the various region/locale configurations.
 *
 * The configuration for each test is represented by an object having the
 * following properties:
 *
 * - identifier (string)
 *   The identifier for the search engine under test.
 * - default (object)
 *   An inclusion/exclusion configuration (see below) to detail when this engine
 *   should be listed as default.
 *
 * The inclusion/exclusion configuration is represented as an object having the
 * following properties:
 *
 * - included (array)
 *   An optional array of region/locale pairs.
 * - excluded (array)
 *   An optional array of region/locale pairs.
 *
 * If the object is empty, the engine is assumed not to be part of any locale/region
 * pair.
 * If the object has `excluded` but not `included`, then the engine is assumed to
 * be part of every locale/region pair except for where it matches the exclusions.
 *
 * The region/locale pairs are represented as an object having the following
 * properties:
 *
 * - region (array)
 *   An array of two-letter region codes.
 * - locale (object)
 *   A locale object which may consist of:
 *   - matches (array)
 *     An array of locale strings which should exactly match the locale.
 *   - startsWith (array)
 *     An array of locale strings which the locale should start with.
 */
class SearchConfigTest {
  /**
   * @param {object} config
   *   The initial configuration for this test, see above.
   */
  constructor(config = {}) {
    this._config = config;

    // This is intended for development-only. Setting it to true restricts the
    // set of locales and regions that are covered, to provide tests that are
    // quicker to run.
    // Turning it on will generate one error at the end of the test, as a reminder
    // that it needs to be changed back before shipping.
    this._testDebug = false;
  }

  /**
   * Sets up the test.
   */
  async setup() {
    AddonTestUtils.init(GLOBAL_SCOPE);
    AddonTestUtils.createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "42", "42");

    // Disable region checks.
    Services.prefs.setBoolPref("browser.search.geoSpecificDefaults", false);
    Services.prefs.setCharPref("browser.search.geoip.url", "");

    await AddonTestUtils.promiseStartupManager();
    await Services.search.init();

    // Note: we don't use the helper function here, so that we have at least
    // one message output per process.
    Assert.ok(Services.search.isInitialized,
      "Should have correctly initialized the search service");
  }

  /**
   * Runs the test.
   */
  async run() {
    const locales = await this._getLocales();
    const regions = this._regions;

    // We loop on region and then locale, so that we always cause a re-init
    // when updating the requested/available locales.
    for (let region of regions) {
      for (let locale of locales) {
        info(`Checking region: "${region}" locale: "${locale}"`);
        await this._reinit(region, locale);

        this._assertDefaultEngines(region, locale);
        const engines = await Services.search.getVisibleEngines();
        const isPresent = this._assertAvailableEngines(region, locale, engines);
        if (isPresent) {
          this._assertCorrectDomains(region, locale, engines);
        }
      }
    }

    this.assertOk(!this._testDebug, "Should not have test debug turned on in production");
  }

  /**
   * Causes re-initialization of the SearchService with the new region and locale.
   *
   * @param {string} region
   *   The two-letter region code.
   * @param {string} locale
   *   The two-letter locale code.
   */
  async _reinit(region, locale) {
    Services.prefs.setStringPref("browser.search.region", region.toUpperCase());
    const reinitCompletePromise =
      SearchTestUtils.promiseSearchNotification("reinit-complete");
    Services.locale.availableLocales = [locale];
    Services.locale.requestedLocales = [locale];
    Services.search.reInit();
    await reinitCompletePromise;

    this.assertOk(Services.search.isInitialized,
      "Should have completely re-initialization, if it fails check logs for if reinit was successful");
  }

  /**
   * @returns {Set} the list of regions for the tests to run with.
   */
  get _regions() {
    if (this._testDebug) {
      return new Set(["by", "cn", "kz", "us", "ru", "tr"]);
    }
    const chunk = Services.prefs.getIntPref("browser.search.config.test.section", -1) - 1;
    const regions = Services.intl.getAvailableLocaleDisplayNames("region");
    const chunkSize =  Math.ceil(regions.length / 4);
    const startPoint = chunk * chunkSize;
    return regions.slice(startPoint, startPoint + chunkSize);
  }

  /**
   * @returns {array} the list of locales for the tests to run with.
   */
  async _getLocales() {
    if (this._testDebug) {
      return ["be", "en-US", "kk", "tr", "ru", "zh-CN"];
    }
    const data = await OS.File.read(do_get_file("all-locales").path, {encoding: "utf-8"});
    return data.split("\n").filter(e => e != "");
  }

  /**
   * Determines if a locale matches with a locales section in the configuration.
   *
   * @param {object} locales
   * @param {array} [locales.matches]
   *   Array of locale names to match exactly.
   * @param {array} [locales.startsWith]
   *   Array of locale names to match the start.
   * @param {string} locale
   *   The two-letter locale code.
   * @returns {boolean}
   *   True if the locale matches.
   */
  _localeIncludes(locales, locale) {
    if ("matches" in locales &&
        locales.matches.includes(locale)) {
      return true;
    }
    if ("startsWith" in locales) {
      return !!locales.startsWith.find(element => locale.startsWith(element));
    }

    return false;
  }

  /**
   * Determines if a locale/region pair match a section of the configuration.
   *
   * @param {object} section
   *   The configuration section to match against.
   * @param {string} region
   *   The two-letter region code.
   * @param {string} locale
   *   The two-letter locale code.
   * @returns {boolean}
   *   True if the locale/region pair matches the section.
   */
  _localeRegionInSection(section, region, locale) {
    for (const {regions, locales} of section) {
      // If we only specify a regions or locales section then
      // it is always considered included in the other section.
      const inRegions = !regions || regions.includes(region);
      const inLocales = !locales || this._localeIncludes(locales, locale);
      if (inRegions && inLocales) {
        return true;
      }
    }
    return false;
  }

  /**
   * Helper function to find an engine from within a list.
   * Due to Amazon's current complex setup with three different identifiers,
   * if the identifier is 'amazon', then we do a startsWith match. Otherwise
   * we expect the names to equal.
   *
   * @param {Array} engines
   *   The list of engines to check.
   * @param {string} identifier
   *   The identifier to look for in the list.
   * @returns {Engine}
   *   Returns the engine if found, null otherwise.
   */
  _findEngine(engines, identifier) {
    if (identifier == "amazon") {
      return engines.find(engine => engine.identifier.startsWith(identifier));
    }
    return engines.find(engine => engine.identifier == identifier);
  }

  /**
   * Asserts whether the engines rules defined in the configuration are met.
   *
   * @param {Array} engines
   *   The list of engines to check.
   * @param {string} region
   *   The two-letter region code.
   * @param {string} locale
   *   The two-letter locale code.
   * @param {string} section
   *   The section of the configuration to check.
   * @returns {boolean}
   *   Returns true if the engine is expected to be present, false otherwise.
   */
  _assertEngineRules(engines, region, locale, section) {
    const infoString = `region: "${region}" locale: "${locale}"`;
    const config = this._config[section];
    const hasIncluded = "included" in config;
    const hasExcluded = "excluded" in config;
    const identifierIncluded = !!this._findEngine(engines, this._config.identifier);

    // If there's not included/excluded, then this shouldn't be the default anywhere.
    if (section == "default" && !hasIncluded && !hasExcluded) {
      this.assertOk(!identifierIncluded,
        `Should not be ${section} for any locale/region,
         currently set for ${infoString}`);
      return false;
    }

    // If there's no included section, we assume the engine is default everywhere
    // and we should apply the exclusions instead.
    let included = (hasIncluded &&
      this._localeRegionInSection(config.included, region, locale));

    let notExcluded = (hasExcluded &&
     !this._localeRegionInSection(config.excluded, region, locale));

    if (included || notExcluded) {
      this.assertOk(identifierIncluded, `Should be ${section} for ${infoString}`);
      return true;
    }
    this.assertOk(!identifierIncluded, `Should not be ${section} for ${infoString}`);
    return false;
  }

  /**
   * Asserts whether the engine is correctly set as default or not.
   *
   * @param {string} region
   *   The two-letter region code.
   * @param {string} locale
   *   The two-letter locale code.
   */
  _assertDefaultEngines(region, locale) {
    this._assertEngineRules([Services.search.originalDefaultEngine], region,
                            locale, "default");
  }

  /**
   * Asserts whether the engine is correctly available or not.
   *
   * @param {string} region
   *   The two-letter region code.
   * @param {string} locale
   *   The two-letter locale code.
   * @param {array} engines
   *   The current visible engines.
   * @returns {boolean}
   *   Returns true if the engine is expected to be present, false otherwise.
   */
  _assertAvailableEngines(region, locale, engines) {
    return this._assertEngineRules(engines, region, locale, "available");
  }

  /**
   * Asserts whether the engine is using the correct domains or not.
   *
   * @param {string} region
   *   The two-letter region code.
   * @param {string} locale
   *   The two-letter locale code.
   * @param {array} engines
   *   The current visible engines.
   */
  _assertCorrectDomains(region, locale, engines) {
    const [expectedDomain, domainConfig] =
      Object.entries(this._config.domains).find(([key, value]) =>
        this._localeRegionInSection(value.included, region, locale));

    this.assertOk(expectedDomain,
      `Should have an expectedDomain for the engine in region: "${region}" locale: "${locale}"`);

    const engine = this._findEngine(engines, this._config.identifier);
    this.assertOk(engine, "Should have an engine present");

    const searchForm = new URL(engine.searchForm);
    this.assertOk(searchForm.host.endsWith(expectedDomain),
      `Should have the correct search form domain for region: "${region}" locale: "${locale}".
       Got "${searchForm.host}", expected to end with "${expectedDomain}".`);

    for (const urlType of [URLTYPE_SUGGEST_JSON, URLTYPE_SEARCH_HTML]) {
      const submission = engine.getSubmission("test", urlType);
      if (urlType == URLTYPE_SUGGEST_JSON &&
          (this._config.noSuggestionsURL || domainConfig.noSuggestionsURL)) {
        this.assertOk(!submission, "Should not have a submission url");
      } else if (this._config.searchUrlBase) {
          this.assertEqual(submission.uri.prePath + submission.uri.filePath,
            this._config.searchUrlBase + domainConfig.searchUrlEnd,
            `Should have the correct domain for type: ${urlType} region: "${region}" locale: "${locale}".`);
      } else {
        this.assertOk(submission.uri.host.endsWith(expectedDomain),
          `Should have the correct domain for type: ${urlType} region: "${region}" locale: "${locale}".
           Got "${submission.uri.host}", expected to end with "${expectedDomain}".`);
      }
    }
  }

  /**
   * Helper functions which avoid outputting test results when there are no
   * failures. These help the tests to run faster, and avoid clogging up the
   * python test runner process.
   */
  assertOk(value, message) {
    if (!value || this._testDebug) {
      Assert.ok(value, message);
    }
  }

  assertEqual(actual, expected, message) {
    if (actual != expected || this._testDebug) {
      Assert.equal(actual, expected, message);
    }
  }
}
