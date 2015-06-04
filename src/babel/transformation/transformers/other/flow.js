export function Flow(node) {
  this.dangerouslyRemove();
}

export function ClassProperty(node) {
  node.typeAnnotation = null;
}

export function Class(node) {
  node.implements = null;
}

export function Func/*tion*/(node) {
  for (var i = 0; i < node.params.length; i++) {
    var param = node.params[i];
    param.optional = false;
  }
}

export function TypeCastExpression(node) {
  return node.expression;
}

export function ImportDeclaration(node) {
  if (node.isType) this.dangerouslyRemove();
}

export function ExportDeclaration(node) {
  if (this.get("declaration").isTypeAlias()) this.dangerouslyRemove();
}
