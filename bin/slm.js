#!/usr/bin/env node

'use strict';

/**
 * Dependencies
 */

const fs = require('fs');
const path = require('path');

const slm = require('slm').compile;
const beautify = require('js-beautify').html;
const { marked } = require('marked');
const chokidar = require('chokidar');

const pa11y = require(`${__dirname}/pa11y`);
const args = require(`${__dirname}/util/args`).args;
const cnsl = require(`${__dirname}/util/console`);
const resolve = require(`${__dirname}/util/resolve`);

const alerts = resolve('config/alerts');
const global = resolve('config/global');

/**
 * Set options to a function for watching config changes
 *
 * @return  {Object}  Containing the script options
 */
const options = () => {
  let config = resolve('config/slm', true, false);
  let source = path.join(global.base, global.src);
  let base_path = `${source}`;
  let ext = '.slm';

  return {
    config: config,
    source: source,
    dist: path.join(global.base, global.dist),
    base_path: base_path,
    views: path.join(base_path, global.entry.views),
    ext: ext,
    globs: config.globs || [
      resolve('config/slm', false),
      path.join(source, `/**/*${ext}`),
      path.join(source, '/**/*.md')
    ]
  }
}

/**
 * Our Chokidar Watcher
 *
 * @type {Source} https://github.com/paulmillr/chokidar
 */
const watcher = chokidar.watch(options().globs, global.chokidar);

/**
 * Write the html file to the distribution folder
 *
 * @param  {String}  file  The file source
 * @param  {Object}  data  The data to pass to the file
 */
const write = async (file, data) => {
  try {
    let opts = options();
    let dist = file.replace(opts.ext, '.html').replace(opts.views, opts.dist);

    if (!fs.existsSync(path.dirname(dist))){
      fs.mkdirSync(path.dirname(dist));
    }

    if (opts.config.beautify) {
      data = beautify(data, opts.config.beautify);
    }

    fs.writeFileSync(dist, data);

    cnsl.describe(`${alerts.success} Slm in ${alerts.str.path(file)} out ${alerts.str.path(dist)}`);

    return dist;
  } catch (err) {
    cnsl.error(`Slm (write): ${err.stack}`);
  }
}


/**
 * Markdown Methods
 */

const mrkdwn = {
  /**
   * Replace code blocks with the desired slm template
   *
   * @param   {Object}  data  File contents
   *
   * @return  {String}        File contents with compiled slm
   */
  slm: function(data) {
    let blocks = data.match(/include{{\s*[-@/\w\.]+\s*}}/g);

    if (blocks) {
      blocks.forEach(element => {
        let file = element.replace('include{{', '').replace('}}', '').trim();

        let compiled = include(file);

        data = data.replace(element, compiled);
      });
    }

    return data;
  },

  /**
   * Replace mustache like variables with localized vars
   *
   * @param   {String}  data  Compiled markdown
   *
   * @return  {String}        Markdown with interpreted variables
   */
  vars: function(data) {
    let blocks = data.match(/{{\s*[\w\.\-\_]+\s*}}/g);

    if (blocks) {
      blocks.forEach(element => {
        if (element.includes('this.')) {
          let variable = element.replace('{{', '').replace('}}', '')
            .replace('this.', '').trim().split('.');

          let obj = options().config;

          while (variable.length) {
            obj = obj[variable.shift()];
          }

          data = data.replace(element, obj);
        }
      });
    }

    return data;
  }
};

/**
 * Include a file in a template
 *
 * @param  {String}  file   The relative path of the file
 *
 * @return {String}         The compiled file
 */
const include = (file, locals = {}) => {
  let data = file;
  let extname = path.extname(file);
  let opts = options();

  // Assume file is slm if extension isn't specified
  if (extname === '') {
    extname = opts.ext;
    file = file + extname;
  }

  let handler = extname.replace('.', '');

  // Set includes base path (source)
  let dir = opts.source;

  file = path.join(dir, file);

  // Pass file to the compile handler
  if (compile.hasOwnProperty(handler)) {
    data = compile[handler](file, locals);
  } else {
    data = compile['default'](file, locals);

    cnsl.notify(`${alerts.info} Slm (include): no handler exists for ${extname} files. Rendering as is.`);
  }

  return data;
};

/**
 * Compiling methods
 */
const compile = {
  /**
   * Read a slm file and compile it to html, return the data.
   *
   * @param  {String}  file  The path of the file
   * @param  {String}  dir   The base directory of the file
   *
   * @return {String}        The compiled html
   */
  slm: (file, locals = {}) => {
    try {
      if (!fs.existsSync(file)) {
        return '';
      }

      let src = fs.readFileSync(file, 'utf-8');
      let opts = options();

      locals = Object.assign(locals, opts.config);

      // Make the include method available to templates
      locals.include = include;

      let data = slm(src, {
          filename: file,
          basePath: opts.base_path,
          useCache: false
        })(locals);

      if (opts.config.beautify) {
        data = beautify(data, opts.config.beautify);
      }

      return data;
    } catch (err) {
      cnsl.error(`Slm failed (compile.slm): ${err.stack}`);
    }
  },

  /**
   * Read a markdown file and compile it to html, return the data.
   *
   * @param  {String}  file  Path to the file to compile
   *
   * @return {String}        The compiled html
   */
  md: (file, locals = {}) => {
    try {
      if (!fs.existsSync(file)) {
        return '';
      }

      let md = fs.readFileSync(file, 'utf-8');

      marked.setOptions(options().config.marked);

      /**
       * Renderer for code blocks
       *
       * @var {Object}
       */
      let renderer = {
        code(code) {
          let escaped = code.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/'/g, '&#39;')
            .replace(/"/g, '&quot;');

          return `<div class="code-block"><pre>${escaped}</pre></div>`;
        }
      };

      marked.use({renderer});

      md = marked(md);

      md = mrkdwn.slm(md);

      md = mrkdwn.vars(md);

      return md;
    } catch (err) {
      cnsl.error(`Slm failed (compile.md): ${err.stack}`);
    }
  },

  /**
   * Read a file and return it's contents.
   *
   * @param  {String}  file  Path to the file to compile
   *
   * @return {String}        The file contents
   */
  default: (file, locals = {}) => {
    try {
      if (!fs.existsSync(file)) {
        return '';
      }

      return fs.readFileSync(file, 'utf-8');
    } catch (err) {
      cnsl.error(`Slm failed (compile.default): ${err.stack}`);
    }
  }
};

/**
 * The main function to execute on files
 *
 * @param  {String}  file  The path of the file to read
 */
const main = async (file) => {
  if (file.includes(options().ext)) {
    let compiled = await compile.slm(file);

    let dist = await write(file, compiled);

    if (!args.nopa11y) await pa11y.main(dist);

    return dist;
  }
}

/**
 * Read a specific file or if it's a directory, read all of the files in it
 *
 * @param  {String}  file  A single file or directory to recursively walk
 * @param  {String}  dir   The base directory of the file
 */
const walk = async (file, dir = false) => {
  let opts = options();
  dir = (!dir) ? opts.views : dir;
  file = (file.includes(dir)) ? file : path.join(dir, file);

  if (file.includes(opts.ext)) {
    await main(file);
  } else {
    try {
      let files = fs.readdirSync(file, 'utf-8');

      for (let i = files.length - 1; i >= 0; i--) {
        await walk(files[i], file);
      }
    } catch (err) {
      cnsl.error(`Slm failed (walk): ${err.stack}`);
    }
  }
};

/**
 * Tne runner for single commands and the watcher
 *
 * @param  {String}  dir  The base directory of the file
 */
const run = async () => {
  try {
    let opts = options();
    let dir = opts.views;

    // Skip and notify if the views directory does not exist
    if (!fs.existsSync(dir)) {
      cnsl.watching(`Slm skipping. ${alerts.str.path(dir)} directory does not exist.`);

      process.exit(0);
    }

    let views = fs.readdirSync(dir).filter(view => view.includes(opts.ext));

    // Watcher command
    if (args.watch) {
      watcher.on('change', async changed => {
        opts = options();

        if (process.env.NODE_ENV === 'development') {
          // Check the parent directory of the changed file
          let hasView = views.some(view => {
            let pttrn = path.basename(view, opts.ext);

            return (
               path.dirname(changed).includes(pttrn) &&
              !path.dirname(changed).includes(dir)
            );
          });

          // Check that the file is in the views directory
          let inViews = changed.includes(dir);

          cnsl.watching(`Detected change on ${alerts.str.path(changed)}`);

          // Modify the changed file to the view if the file has a view
          let pttrn = path.basename(path.dirname(changed));
          let view = path.join(dir, pttrn + opts.ext);

          changed = (hasView) ? view : changed;

          if (hasView || inViews) {
            // Run the single compiler task if the changed
            // file is a view or has a view
            main(changed);
          } else {
            // Walk if the changed file is in the views directory
            // such as a layout template or partial
            await walk(dir);
          }
        } else {
          await walk(dir);
        }
      });

      cnsl.watching(`Slm watching ${alerts.str.ext(opts.globs.join(', '))}`);
    } else {
      await walk(dir);

      cnsl.success(`Slm finished`);

      process.exit(0);
    }
  } catch (err) {
    cnsl.error(`Slm failed (run): ${err.stack}`);
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
  options: options
};
