import * as t from "../../../types";

var visitor = {
  ReferencedIdentifier(node, parent, scope, state) {
    if (t.isFor(parent) && parent.left === node) return;

    var declared = state.letRefs[node.name];
    if (!declared) return;

    // declared node is different in this scope
    if (scope.getBindingIdentifier(node.name) !== declared) return;

    var assert = t.callExpression(
      state.file.addHelper("temporal-assert-defined"),
      [node, t.literal(node.name), state.file.addHelper("temporal-undefined")]
    );

    this.skip();

    if (t.isAssignmentExpression(parent) || t.isUpdateExpression(parent)) {
      if (parent._ignoreBlockScopingTDZ) return;
      this.parentPath.replaceWith(t.sequenceExpression([assert, parent]));
    } else {
      return t.logicalExpression("&&", assert, node);
    }
  }
};

export var metadata = {
  optional: true,
  group: "builtin-advanced"
};

export var BlockStatement = {
  exit(node, parent, scope, file) {
    var letRefs = node._letReferences;
    if (!letRefs) return;

    this.traverse(visitor, {
      letRefs: letRefs,
      file:    file
    });
  }
};

export { BlockStatement as Program, BlockStatement as Loop };
