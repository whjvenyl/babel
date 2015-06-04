import type Transformer from "./transformer";
import traverse from "../traversal";
import type File from "./file";

/**
 * This class is responsible for traversing over the provided `File`s
 * AST and running it's parent transformers handlers over it.
 */

export default class TransformerPass {
  constructor(file: File, transformer: Transformer) {
    this.transformer = transformer;
    this.handlers    = transformer.handlers;
    this.file        = file;
    this.key         = transformer.key;
  }

  canTransform(): boolean {
    return this.file.transformerDependencies[this.key] ||
           this.file.pipeline.canTransform(this.transformer, this.file.opts);
  }

  transform() {
    var file = this.file;
    file.log.debug(`Start transformer ${this.key}`);
    traverse(file.ast, this.handlers, file.scope, file);
    file.log.debug(`Finish transformer ${this.key}`);
  }
}
