## Testing through ordinary module imports

The user questions the need for special test execution support. The proposed model is that graph source files are available through an index file, so ordinary tests can import them.

Ordinary test runners can test emitted JavaScript modules without a GraphScript runner or an import adapter. An index file can provide a common import location, but it is not required for ordinary module imports.

The saved library-output decision specifies one emitted module per graph node, imported by its unique GraphScript name. It does not yet specify an index file. Do not treat the proposed index file as an approved output requirement.

The earlier recommendation for runner integration is not approved. Test source participation in the graph and exclusion from release output remain open.