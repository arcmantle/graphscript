## Decision

First-release JavaScript library output uses ECMAScript modules only. Do not provide a separate CommonJS output tree or conditional CommonJS package entry.

This does not change the approved source rule that permits external package imports through static ECMAScript imports, dynamic import(), and CommonJS require(). TypeScript output remains part of the existing build choice.