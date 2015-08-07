/**
 * Bundle test runner, test files, and fixture data into a single script
 * suitable for execution in generic JavaScript environments.
 */
"use strict";
var fs = require("fs");
var path = require("path");
var Stream = require("stream");

var browserify = require("browserify");

var mainPath = path.resolve(
  __dirname + "/../../../" + require("../../../package.json").main
);

var streams = {
  fixtures: function() {
    var fixtureDir = __dirname + "/../../unit/fixtures";
    var fixtureStream = new Stream.Readable();
    fixtureStream._read = fixtureStream.write = function() {};

    fs.readdir(fixtureDir, function(err, files) {
      var src = "";
      var fsCache = {};

      if (err) {
        done(err);
        return;
      }

      files.forEach(function(fileName) {
        var relativeName = "/tests/unit/fixtures/" + fileName;

        fsCache[relativeName] = fs.readFileSync(
          fixtureDir + "/" + fileName, { encoding: "utf-8" }
        );
      });

      src += [
        "(function() {",
        "  window.JSHintTestFixtures = " + JSON.stringify(fsCache) + ";",
        "}());"
      ].join("\n");
      fixtureStream.push(src);
      fixtureStream.push(null);
    });

    return fixtureStream;
  },

  /**
   * This script is dependent on the contents of the unit test file directory.
   * It must be generated dynamically for two reasons:
   *
   * 1. So that Browserify includes the test files in the generated bundle
   * 2. So that Nodeunit is explicitly invoked with the tests
   *
   * Although #1 could be addressed through the Browserify API itself, #2 means
   * that passively including the modules will not result in test
   * execution--some code generation is required.
   */
  runAllScript: function() {
    var testDir = "../../unit";
    var stream = new Stream.Readable();
    stream._read = stream.write = function() {};

    fs.readdir(__dirname + "/" + testDir, function(err, allFiles) {
      var testIncludes = allFiles.filter(function(file) {
          return /\.js$/i.test(file);
        }).map(function(file) {
          return "\"" + file + "\": require(\"" + testDir + "/" + file + "\")";
        }).join(",\n");

      fs.readFile(__dirname + "/run-all.js.tmpl", function(err, src) {
        stream.push(
          String(src).replace(/{{\s*INJECT_TEST_INCLUDES\s*}}/, testIncludes)
        );
        stream.push(null);
      });
    });

    return stream;
  }
};

module.exports = function(done) {
  var bundle = browserify({
    insertGlobalVars: {
      /**
       * Ensure that the value of `__dirname` uses Unix path separator across
       * all platforms.
       *
       * By default, Browserify defines the `__dirname` global using the
       * system's native file separator character, but its implementation of
       * `path.resolve` (as used in `fixture-fs.js`) only includes the Unix
       * implementation. This inconsistency does not impact file lookup on
       * either platform, but when path strings are used as key values (as is
       * the case in `fixture-fs.js`), the separator character must be
       * consistent.
       */
      __dirname: function() {
        return "'/tests/unit'";
      }
    }
  });
  var includedFaker = false;

  bundle.require(
    fs.createReadStream(__dirname + "/fixture-fs.js"),
    { expose: "fs" }
  );

  // The nodeunit module expresses a dependency on the 'http' module, but it is
  // not needed by this project's tests. Ignore it to avoid errors when running
  // the tests in JavaScriptCore.
  bundle.ignore("http");

  bundle.add(streams.fixtures());
  bundle.add(streams.runAllScript(), { basedir: __dirname });

  /**
   * When Browserify attempts to bundle the JSHint source, inject a simple
   * "global extraction module"--a CommonJS module that simply exposes the
   * globally-defined JSHint instance. This ensures that the tests run
   * against the version of JSHint built with the project's build script (see
   * above) and not a version dynamically included in the current bundle for
   * test files.
   */
  bundle.transform(function(filename) {
    var faker;

    if (filename === mainPath) {
      includedFaker = true;
      faker = new Stream.Readable();
      faker._read = faker.write = function() {};
      faker.push("exports.JSHINT = window.JSHINT;");
      faker.push(null);
      return faker;
    }

    return new Stream.PassThrough();
  });

  bundle.bundle(function(err, src) {
    if (err) {
      done(err);
      return;
    }

    if (!includedFaker) {
      done(new Error(
        "JSHint extraction module not included in bundled test build."
      ));
      return;
    }

    done(null, src);
  });
};