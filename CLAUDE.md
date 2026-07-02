The Architecture of the App is in @README.md, but here are some key points:

-   The app is structured as a monorepo with Bun workspaces. The main packages are `server` (the backend API and core logic) and `drivers` (device drivers).
-   The `server` package is a Bun application that exposes an HTTP API for managing devices,rooms, and connections. It also includes a device manager that handles the lifecycle of connected devices.
-   The `drivers` package contains individual device drivers, each in its own subpackage (e.g. `driver-pjlink`). Drivers implement a common interface and can be dynamically loaded by the server.
-   The server uses a PostgreSQL database for persistent storage and Redis for caching and pub/sub. The database schema includes tables for devices, rooms, connections, and driver configurations.
-   The server also includes an event bus for internal communication between components, and a registry for managing available drivers and their capabilities.
-   The app is designed to be extensible, allowing new drivers to be added without modifying the core server code. Drivers can define their own configuration and state management logic, and can expose custom commands that can be invoked via the API.

-   The app is written in TypeScript and uses modern language features. It is structured in a modular way, with clear separation of concerns between different components. The codebase includes comprehensive type definitions and documentation to facilitate development and maintenance.
-   After each added feature from the @PLAN.md, the README is updated with a summary of the implementation details and key design decisions related to that feature. This ensures that the documentation remains up-to-date and provides a clear reference for developers working on the project. Also, The Plan is updated to reflect the done work.
-   After every code edit, run the Fallow tool to check the codebase for any potential issues or improvements. This helps maintain code quality and consistency across the project.

### Coding Guidelines

-   Test the code using "bun run test" which runs bun test for the non-ui packages and vitest for the VUE UI package.
-   Never use one-letter variable names, except for loop counters. Use descriptive names that convey the purpose of the variable. This improves code readability and maintainability.
-   Avoid using magic numbers or strings in the code. Instead, define constants or enums with meaningful names to represent these values. This makes the code more self-documenting and easier to understand.
-   Use async/await for asynchronous operations instead of callbacks or promises. This leads to cleaner and more readable code, and helps avoid callback hell.
-   Use TypeScript's type system to enforce type safety and catch potential errors at compile time. Define interfaces and types for complex data structures, and use them consistently throughout the codebase.
-   For .vue files, use the <script setup> syntax for defining components. This simplifies the component structure and reduces boilerplate code. Then follow with <template> and after that with <style> sections as needed.
-   Use the Composition API for managing component state and logic. This promotes better code organization and reusability of logic across components.
-   Use the Pinia state management library for managing global state in the Vue application. This provides a simple and efficient way to manage shared state across components.
-   Use the Vue Router for handling navigation and routing in the application. Define routes in a centralized manner and use route guards to protect access to certain pages based on user authentication or other conditions.
-   Use shadcn or Reka for UI components and styling. These libraries provide a set of pre-designed components and utilities that can be used to build a consistent and visually appealing user interface.
-   Use the Tailwind CSS framework for styling the application. For some more complex styling logic or animations use nested modern CSS in <style> sections of .vue files. This allows for more advanced styling techniques while still leveraging the benefits of Tailwind CSS.
