## JavaScript library module format

Which JavaScript module formats must first-release library output provide?

Options:
- ECMAScript modules only. This requires one output format but does not promise a CommonJS entry for require() consumers.
- Both ECMAScript modules and CommonJS. This supports both consumer formats but requires two output trees and conditional package exports. Shared state must have a defined identity when a consumer loads both formats.

Recommendation, not an approved decision: ECMAScript modules only for the first release. Keep the approved source rule that permits external package imports through static ECMAScript imports, dynamic import(), and CommonJS require(). Source acceptance does not itself require GraphScript libraries to have both output formats.

TypeScript output remains part of the existing build choice. This question concerns emitted JavaScript library modules, not a change to that choice.