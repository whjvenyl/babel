import detectIndent from "detect-indent";
import Whitespace from "./whitespace";
import NodePrinter from "./node/printer";
import repeating from "repeating";
import SourceMap from "./source-map";
import Position from "./position";
import * as messages from "../messages";
import Buffer from "./buffer";
import extend from "lodash/object/extend";
import each from "lodash/collection/each";
import n from "./node";
import * as t from "../types";

class CodeGenerator {
  constructor(ast, opts, code) {
    opts = opts || {};

    this.comments = ast.comments || [];
    this.tokens   = ast.tokens || [];
    this.format   = CodeGenerator.normalizeOptions(code, opts, this.tokens);
    this.opts     = opts;
    this.ast      = ast;

    this.whitespace = new Whitespace(this.tokens);
    this.position   = new Position;
    this.map        = new SourceMap(this.position, opts, code);
    this.buffer     = new Buffer(this.position, this.format);
  }

  static normalizeOptions(code, opts, tokens) {
    var style = "  ";
    if (code) {
      var indent = detectIndent(code).indent;
      if (indent && indent !== " ") style = indent;
    }

    var format = {
      retainLines: opts.retainLines,
      comments: opts.comments == null || opts.comments,
      compact: opts.compact,
      quotes: CodeGenerator.findCommonStringDelimiter(code, tokens),
      indent: {
        adjustMultilineComment: true,
        style: style,
        base: 0
      }
    };

    if (format.compact === "auto") {
      format.compact = code.length > 100000; // 100KB

      if (format.compact) {
        console.error("[BABEL] " + messages.get("codeGeneratorDeopt", opts.filename, "100KB"));
      }
    }

    return format;
  }

  static findCommonStringDelimiter(code, tokens) {
    var occurences = {
      single: 0,
      double: 0
    };

    var checked = 0;

    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token.type.label !== "string") continue;

      var raw = code.slice(token.start, token.end);
      if (raw[0] === "'") {
        occurences.single++;
      } else {
        occurences.double++;
      }

      checked++;
      if (checked >= 3) break;
    }

    if (occurences.single > occurences.double) {
      return "single";
    } else {
      return "double";
    }
  }

  static generators = {
    templateLiterals: require("./generators/template-literals"),
    comprehensions:   require("./generators/comprehensions"),
    expressions:      require("./generators/expressions"),
    statements:       require("./generators/statements"),
    classes:          require("./generators/classes"),
    methods:          require("./generators/methods"),
    modules:          require("./generators/modules"),
    types:            require("./generators/types"),
    flow:             require("./generators/flow"),
    base:             require("./generators/base"),
    jsx:              require("./generators/jsx")
  };

  generate() {
    var ast = this.ast;

    this.print(ast);

    if (ast.comments) {
      var comments = [];
      for (var comment of (ast.comments: Array)) {
        if (!comment._displayed) comments.push(comment);
      }
      this._printComments(comments);
    }

    return {
      map:  this.map.get(),
      code: this.buffer.get()
    };
  }

  buildPrint(parent) {
    return new NodePrinter(this, parent);
  }

  catchUp(node, parent, leftParenPrinted) {
    // catch up to this nodes newline if we're behind
    if (node.loc && this.format.retainLines && this.buffer.buf) {
      var needsParens = false;
      if (!leftParenPrinted && parent &&
          this.position.line < node.loc.start.line && t.isTerminatorless(parent)) {
        needsParens = true;
        this._push("(");
      }
      while (this.position.line < node.loc.start.line) {
        this._push("\n");
      }
      return needsParens;
    }
    return false;
  }

  _printNewline(leading, node, parent, opts) {
    if (!opts.statement && !n.isUserWhitespacable(node, parent)) {
      return;
    }

    var lines = 0;

    if (node.start != null && !node._ignoreUserWhitespace) {
      // user node
      if (leading) {
        lines = this.whitespace.getNewlinesBefore(node);
      } else {
        lines = this.whitespace.getNewlinesAfter(node);
      }
    } else {
      // generated node
      if (!leading) lines++; // always include at least a single line after
      if (opts.addNewlines) lines += opts.addNewlines(leading, node) || 0;

      var needs = n.needsWhitespaceAfter;
      if (leading) needs = n.needsWhitespaceBefore;
      if (needs(node, parent)) lines++;

      // generated nodes can't add starting file whitespace
      if (!this.buffer.buf) lines = 0;
    }

    this.newline(lines);
  }

  print(node, parent, opts = {}) {
    if (!node) return;

    if (parent && parent._compact) {
      node._compact = true;
    }

    var oldConcise = this.format.concise;
    if (node._compact) {
      this.format.concise = true;
    }

    if (this[node.type]) {
      var needsNoLineTermParens = n.needsParensNoLineTerminator(node, parent);
      var needsParens           = needsNoLineTermParens || n.needsParens(node, parent);

      if (needsParens) this.push("(");
      if (needsNoLineTermParens) this.indent();

      this.printLeadingComments(node, parent);

      var needsParensFromCatchup = this.catchUp(node, parent, needsParens);

      this._printNewline(true, node, parent, opts);

      if (opts.before) opts.before();
      this.map.mark(node, "start");

      this[node.type](node, this.buildPrint(node), parent);

      if (needsNoLineTermParens) {
        this.newline();
        this.dedent();
      }
      if (needsParens || needsParensFromCatchup) this.push(")");

      this.map.mark(node, "end");
      if (opts.after) opts.after();

      this.format.concise = oldConcise;

      this._printNewline(false, node, parent, opts);

      this.printTrailingComments(node, parent);
    } else {
      throw new ReferenceError(`unknown node of type ${JSON.stringify(node.type)} with constructor ${JSON.stringify(node && node.constructor.name)}`);
    }
  }

  printJoin(print, nodes, opts = {}) {
    if (!nodes || !nodes.length) return;

    var len = nodes.length;

    if (opts.indent) this.indent();

    var printOpts = {
      statement: opts.statement,
      addNewlines: opts.addNewlines,
      after: () => {
        if (opts.iterator) {
          opts.iterator(node, i);
        }

        if (opts.separator && i < len - 1) {
          this.push(opts.separator);
        }
      }
    };

    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      print.plain(node, printOpts);
    }

    if (opts.indent) this.dedent();
  }

  printAndIndentOnComments(print, node) {
    var indent = !!node.leadingComments;
    if (indent) this.indent();
    print.plain(node);
    if (indent) this.dedent();
  }

  printBlock(print, node) {
    if (t.isEmptyStatement(node)) {
      this.semicolon();
    } else {
      this.push(" ");
      print.plain(node);
    }
  }

  generateComment(comment) {
    var val = comment.value;
    if (comment.type === "CommentLine") {
      val = `//${val}`;
    } else {
      val = `/*${val}*/`;
    }
    return val;
  }

  printTrailingComments(node, parent) {
    this._printComments(this.getComments("trailingComments", node, parent));
  }

  printLeadingComments(node, parent) {
    this._printComments(this.getComments("leadingComments", node, parent));
  }

  getComments(key, node, parent) {
    if (t.isExpressionStatement(parent)) {
      return [];
    }

    var comments = [];
    var nodes    = [node];

    if (t.isExpressionStatement(node)) {
      nodes.push(node.argument);
    }

    for (let node of (nodes: Array)) {
      comments = comments.concat(this._getComments(key, node));
    }

    return comments;
  }

  _getComments(key, node) {
    return (node && node[key]) || [];
  }

  _printComments(comments) {
    if (this.format.compact) return;
    if (!this.format.comments) return;
    if (!comments || !comments.length) return;

    for (var comment of (comments: Array)) {
      var skip = false;

      if (this.ast.comments) {
        // find the original comment in the ast and set it as displayed
        for (var origComment of (this.ast.comments: Array)) {
          if (origComment.start === comment.start) {
            // comment has already been output
            if (origComment._displayed) skip = true;

            origComment._displayed = true;
            break;
          }
        }
      }

      if (skip) return;

      this.catchUp(comment);

      // whitespace before
      this.newline(this.whitespace.getNewlinesBefore(comment));

      var column = this.position.column;
      var val    = this.generateComment(comment);

      if (column && !this.isLast(["\n", " ", "[", "{"])) {
        this._push(" ");
        column++;
      }

      //
      if (comment.type === "CommentBlock" && this.format.indent.adjustMultilineComment) {
        var offset = comment.loc.start.column;
        if (offset) {
          var newlineRegex = new RegExp("\\n\\s{1," + offset + "}", "g");
          val = val.replace(newlineRegex, "\n");
        }

        var indent = Math.max(this.indentSize(), column);
        val = val.replace(/\n/g, `\n${repeating(" ", indent)}`);
      }

      if (column === 0) {
        val = this.getIndent() + val;
      }

      // force a newline for line comments when retainLines is set in case the next printed node
      // doesn't catch up
      if (this.format.retainLines && comment.type === "CommentLine") {
        val += "\n";
      }

      //
      this._push(val);

      // whitespace after
      this.newline(this.whitespace.getNewlinesAfter(comment));
    }
  }
}

each(Buffer.prototype, function (fn, key) {
  CodeGenerator.prototype[key] = function () {
    return fn.apply(this.buffer, arguments);
  };
});

each(CodeGenerator.generators, function (generator) {
  extend(CodeGenerator.prototype, generator);
});

module.exports = function (ast, opts, code) {
  var gen = new CodeGenerator(ast, opts, code);
  return gen.generate();
};

module.exports.CodeGenerator = CodeGenerator;
