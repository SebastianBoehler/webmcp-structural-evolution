# Type resolution adapters

`tsconfig.json` maps `@dimforge/rapier3d-deterministic-compat` directly to its
checked-in package declaration. Version 0.18.1 includes `rapier.d.ts`, but its
package export map does not expose that declaration to TypeScript's bundler
resolver. Remove the mapping when the pinned Rapier package exports its types.
