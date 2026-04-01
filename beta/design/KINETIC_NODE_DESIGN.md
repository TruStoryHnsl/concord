# Design System Specification: The Kinetic Node

## 1. Overview & Creative North Star
### Creative North Star: "The Fluid Network"
This design system moves away from the static, boxy layouts of traditional chat apps to embrace a "Fluid Network" aesthetic. It rejects the heavy, dark-grey "Discord-clone" look in favor of deep, atmospheric teals and electric accents. The goal is to make decentralized P2P communication feel as fast as a neural impulse and as secure as a physical vault.

We break the "template" look through **Intentional Asymmetry** and **Tonal Depth**. Instead of rigid vertical sidebars, we use varying surface elevations and expansive "breathing room" to guide the eye. Elements should feel like they are floating in a digital ether, connected by invisible logic but physically distinct.

---

## 2. Colors & Surface Philosophy
The palette is built on a foundation of "Midnight Teal" and "Slate," punctuated by high-energy indigo and mint.

### The "No-Line" Rule
**Strict Mandate:** Designers are prohibited from using 1px solid borders to define sections. Layout boundaries must be established exclusively through background color shifts. 
- *Example:* A chat input area should be a `surface-container-high` block sitting on a `surface` background, rather than a stroked box.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of semi-transparent layers. 
- **Base Level:** `surface` (#0c0e11) - The canvas.
- **Secondary Level:** `surface-container-low` (#111417) - Large layout blocks (e.g., Message lists).
- **Interactive Level:** `surface-container-high` (#1d2024) - Modals, popovers, and active states.
- **Top Level:** `surface-container-highest` (#23262a) - Floating tooltips or intense focus states.

### The "Glass & Gradient" Rule
To achieve a premium "modular" feel, use **Glassmorphism** for floating overlays. 
- **Formula:** `surface-variant` at 60% opacity + 20px Backdrop Blur.
- **Signature Texture:** Use a subtle linear gradient for primary CTAs: `primary` (#a4a5ff) to `primary-container` (#9496ff) at a 135° angle. This provides a "glow" that flat colors cannot replicate.

---

## 3. Typography
The system utilizes a dual-type scale to balance tech-forward personality with high-utility readability.

- **Display & Headlines (Space Grotesk):** A low-contrast, geometric sans-serif. Used for "Distributed Node" aesthetic. The wide apertures feel open and modern.
  - *Usage:* Use `display-lg` for onboarding and `headline-sm` for channel headers.
- **UI & Body (Manrope):** A high-readability sans-serif with modern proportions.
  - *Usage:* `body-md` for chat messages; `label-sm` (all caps, 0.05em tracking) for metadata like timestamps or node IDs.

**The Editorial Shift:** Increase line height for body text to `1.6` to ensure that long technical conversations remain legible and "airy."

---

## 4. Elevation & Depth
Depth is a functional tool, not a stylistic flourish.

### Layering Principle
Achieve "lift" by stacking tiers. Place a `surface-container-lowest` card on a `surface-container-low` section. This creates a soft, natural inset effect that feels sophisticated and "carved."

### Ambient Shadows
Shadows are reserved only for elements that physically move over others (e.g., a dragged file or a context menu).
- **Spec:** Color: `on-surface` at 6% opacity. Blur: 32px. Y-Offset: 16px. Spread: -4px.
- Avoid pure black shadows; they "muddy" the deep teal background.

### The "Ghost Border" Fallback
If contrast is legally required for accessibility:
- **Spec:** `outline-variant` (#46484b) at 15% opacity. It must look like a "whisper" of a line, never a hard constraint.

---

## 5. Components
### Buttons
- **Primary:** Gradient fill (`primary` to `primary-container`), `rounded-md`, white text. No shadow—use a 2px `primary-dim` outer glow on hover.
- **Tertiary (Ghost):** No background. Text in `primary`. On hover, apply a `surface-container-high` background.

### Input Fields
- **Styling:** Never use a bottom-line-only or 4-sided stroke. Use a `surface-container-low` background with a `rounded-md` corner.
- **Focus State:** Transition background to `surface-container-high` and add a subtle `primary` glow.

### Node Chips
- Small, `rounded-full` indicators. 
- **Active Node:** `secondary-container` background with `on-secondary` text.
- **Inactive:** `surface-container-highest` background with `on-surface-variant` text.

### Communication Cards & Lists
- **Prohibition:** No divider lines between messages or contacts. 
- **Separation:** Use `spacing-4` (0.9rem) vertical gaps. For logical groups, use a subtle background shift to `surface-container-low`.

### Distributed Patterns (Pattern Component)
- Use a background SVG pattern of "nodes" (0.5pt dots connected by 0.25pt lines) at 5% opacity. This should only appear in large empty states or the sidebar to reinforce the P2P aesthetic.

---

## 6. Do's and Don'ts

### Do
- **Do** use `rounded-xl` (1.5rem) for large containers to lean into the "friendly tech" feel.
- **Do** use `secondary` (#afefdd) for "Success" or "Online" states to maintain the teal/mint freshness.
- **Do** use `spacing-10` and `spacing-16` for page margins to create a high-end editorial "breathing" space.

### Don't
- **Don't** use pure #000000 or pure #FFFFFF. Always use the specified surface and on-surface tokens to keep the "Midnight Slate" tonality.
- **Don't** use standard "Drop Shadows" on buttons. If it needs to pop, use color contrast or a tonal shift.
- **Don't** crowd the interface. If the screen feels full, increase the spacing tokens rather than adding dividers.

### Accessibility Note
Ensure `on-surface-variant` text (#aaabaf) is only used for non-essential metadata. All primary communication must use `on-surface` (#f9f9fd) to guarantee a 4.5:1 contrast ratio against the dark backgrounds.