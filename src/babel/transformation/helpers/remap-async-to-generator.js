import * as t from "../../types";

var awaitVisitor = {
  Function() {
    this.skip();
  },

  AwaitExpression(node) {
    node.type = "YieldExpression";

    if (node.all) {
      // await* foo; -> yield Promise.all(foo);
      node.all = false;
      node.argument = t.callExpression(t.memberExpression(t.identifier("Promise"), t.identifier("all")), [node.argument]);
    }
  }
};

var referenceVisitor = {
  ReferencedIdentifier(node, parent, scope, state) {
    var name = state.id.name;
    if (node.name === name && scope.bindingIdentifierEquals(name, state.id)) {
      return state.ref = state.ref || scope.generateUidIdentifier(name);
    }
  }
};

export default function (node, callId, scope) {
  node.async = false;
  node.generator = true;

  scope.traverse(node, awaitVisitor, state);

  var call = t.callExpression(callId, [node]);

  var id = node.id;
  node.id = null;

  if (t.isFunctionDeclaration(node)) {
    var declar = t.variableDeclaration("let", [
      t.variableDeclarator(id, call)
    ]);
    declar._blockHoist = true;
    return declar;
  } else {
    if (id) {
      var state = { id: id };
      scope.traverse(node, referenceVisitor, state);

      if (state.ref) {
        scope.parent.push({ id: state.ref });
        return t.assignmentExpression("=", state.ref, call);
      }
    }

    return call;
  }
}
