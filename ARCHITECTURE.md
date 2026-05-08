# Focus Technical Documentation

## 1. Overview
**Focus** is a Windows-first desktop application designed to help users maintain productivity by blocking distracting apps and websites. It provides a robust system for creating "Focus Profiles" with granular rules, automated schedules, and a "Strict Mode" to prevent bypassing the blocks.

### Key Value Propositions
- **System-wide Site Blocking**: Modifies the Windows `hosts` file to block sites across all browsers.
- **Process-level App Blocking**: Monitors foreground windows and terminates blocked applications.
- **Strict Enforcement**: Timer-based locks that prevent disabling blocks until the timer expires.
- **Visual Analytics**: Tracks screen time and blocked attempts to provide insights into focus habits.

---

## 2. Architecture
The application is built on **Electron**, following the standard multi-process architecture:

- **Main Process (`src/main`)**: Handles system-level operations (hosts file modification, process monitoring, local HTTP server, and data persistence).
- **Renderer Process (`src/renderer`)**: A React-based single-page application that provides the user interface.
- **Shared (`src/shared`)**: Contains TypeScript interfaces, IPC channel definitions, and core business logic (like rule evaluation) used by both processes.

### Technology Stack
- **Framework**: Electron 42
- **Frontend**: React 19, Vite 7, Lucide React (Icons)
- **Language**: TypeScript
- **Styling**: Vanilla CSS with a custom design system
- **Packaging**: Electron Builder (NSIS for Windows installation)

---

## 3. Core Features & Implementation

### 3.1 Website Blocking (`HostsBlocker.ts`)
Focus achieves system-wide website blocking by modifying the Windows `hosts` file (`C:\Windows\System32\drivers\etc\hosts`).
- **Mechanism**: Redirects blocked domains to `127.0.0.1` and `::1`.
- **Admin Elevation**: Since modifying the `hosts` file requires administrative privileges, the app checks for elevation on startup and relaunches itself as admin if necessary using PowerShell's `RunAs` verb.
- **DNS Flushing**: Automatically runs `ipconfig /flushdns` after updates to ensure changes take effect immediately.
- **Safety**: Uses specialized markers (`# >>> Focus managed block`) to ensure it only modifies its own section of the `hosts` file.

### 3.2 App Blocking (`WindowsMonitor.ts`)
The application monitors active desktop windows to detect and close forbidden programs.
- **Polling**: Every few seconds (configurable), it executes a PowerShell script to identify the current foreground process and its window title.
- **Process Termination**: If the foreground process matches a blocked application (by executable name, path, or display name), it uses `taskkill.exe` to terminate the process.
- **Blocking Overlay**: When an app is terminated, Focus displays a full-screen, "always-on-top" Electron window to inform the user that the app is blocked.

### 3.3 Block Page Server (`blockPageServer.ts`)
To provide a better user experience when a website is blocked, Focus runs a local HTTP server.
- **Port**: Defaults to `47831` (configurable).
- **Function**: When a browser attempts to reach a blocked site (redirected to `127.0.0.1`), this server responds with a custom "Blocked by Focus" HTML page.

### 3.4 State Management & Persistence (`store.ts`)
All user data, including profiles, rules, and history, is managed by the `FocusStore`.
- **Storage**: Data is persisted as a JSON file in the user's `userData` directory (`focus-state.json`).
- **Data Model**: Includes `profiles`, `blockedApps`, `blockedSites`, `schedules`, `focusSessions`, and `usageEvents`.
- **Strict Mode**: Implements logic to prevent any mutations (edits or deletions) to a profile if it is currently "Strict Locked."

---

## 4. User Interface (Renderer)

### 4.1 Design System (`styles.css`)
The UI features a "Premium" aesthetic characterized by:
- **Color Palette**: A professional blue-centric theme (`#0a66ff`) with soft background tints.
- **Typography**: Uses modern fonts like *Manrope* or *IBM Plex Sans*.
- **Components**: Custom-built cards, metrics, toggles, and modal dialogs.
- **Responsiveness**: A two-column layout (Sidebar + Workspace) that adapts to different window sizes.

### 4.2 Main Dashboard (`App.tsx`)
The dashboard is the central hub for managing focus.
- **Profile Management**: Switch between different contexts (e.g., "Work", "Deep Work", "Gaming").
- **Live Metrics**: Real-time display of screen time today, blocked attempts, and active rules.
- **Interactive Rules**: Add websites by domain, choose apps from a file picker or a list of currently running processes.
- **Scheduling**: Define specific days and times when a profile should automatically activate.
- **Manual Sessions**: Quick-start timers (15m, 30m, etc.) for immediate focus blocks.

---

## 5. IPC Communication (`ipc.ts`, `preload.ts`)
Communication between the UI and the system is strictly typed and channeled:
- **`window.focusApi`**: The preload script exposes a safe API to the renderer, preventing direct access to Node.js or Electron internals.
- **Channels**: Standardized channels (e.g., `getState`, `saveProfile`, `relaunchAsAdmin`) ensure predictable data flow.

---

## 6. Development Workflow

### Key Scripts (`package.json`)
- `npm run dev`: Starts Vite for the renderer and launches Electron in development mode.
- `npm run build`: Compiles the TypeScript main process and builds the React renderer.
- `npm run dist`: Packages the application into a production-ready Windows installer (.exe).

### Important Directories
- `/src/main`: System-level logic (Node.js/Electron).
- `/src/renderer`: User interface (React/CSS).
- `/src/shared`: Type definitions and common utilities.
- `/scripts`: Build and startup scripts.
- `/release`: Output directory for the packaged installer.

---

## 7. Technical Highlights
- **PowerShell Integration**: Heavy use of PowerShell for advanced Windows interactions (window enumeration, process detection, admin relaunch).
- **Strict Mode Logic**: A robust implementation of "self-control" where the app refuses to modify its own configuration when a timer is active.
- **Low Overhead**: The app is designed to run in the background with minimal CPU/RAM usage, primarily waking up for polling intervals.
