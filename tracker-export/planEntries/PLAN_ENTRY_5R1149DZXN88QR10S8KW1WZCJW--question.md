## Q2: Supported hosts

Which operating systems and VS Code host types must the first release support?

Recommendation: Support local desktop VS Code and CLI use on Windows, macOS, and Linux. Require release evidence for each declared operating-system and processor combination. Do not promise browser VS Code, remote workspaces, or alternative runtimes unless explicitly added.

Alternative: Support only one operating system initially, which reduces release testing but excludes developers on other systems. Broader remote or browser support adds separate installation and extension-host checks.