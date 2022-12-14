#!/usr/bin/env node

/**
 * Dependencies
 */

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const resolve = require(`${__dirname}/util/resolve`);
const cnsl = require(`${__dirname}/util/console`);

const alerts = resolve('config/alerts');
const config = resolve('config/postcss');
const modules = resolve('config/sass');


/**
 * The single command for PostCSS to process a Sass Module
 *
 * @param  {Array}  files  The contents of config/sass.js
 */
const main = async (style) => {
  let bundle = path.join(style.outDir, style.outFile);
  let css = fs.readFileSync(bundle);

  try {
    let result = await postcss(config.plugins)
      .process(css, {
        from: bundle,
        to: bundle
      });

    fs.writeFileSync(result.opts.to, result.css);

    cnsl.describe(`${alerts.styles} PostCSS on ${alerts.str.path(style.outDir + style.outFile)}`);
  } catch (err) {
    cnsl.error(`PostCSS failed: ${err.stack}`);
  }
}

/**
 * A batch process function for each Sass Module for PostCSS to run on
 *
 * @param  {Array}  files  The contents of config/sass.js
 */
const run = async (styles = modules) => {
  let i = 0;

  try {
    for (i; i < styles.length; i++) {
      await main(styles[i]);
    }
  } catch (err) {
    cnsl.error(`PostCSS failed: ${err.stack}`);
  }
};

/**
 * Export our methods
 *
 * @type {Object}
 */
module.exports = {
  main: main,
  run: run,
  config: config,
  modules: modules
};
