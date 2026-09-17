# Paradox Agent Town — UI Improvement & Simulation Prompt

## CRITICAL RULE: DO NOT RUIN THE CURRENT TOWN

You are improving the **existing Paradox Agent Town**, not replacing it.

**DO NOT rebuild the town from scratch.**
**DO NOT remove the current environment, rooms, furniture, agents, navigation, UI, or working functionality unless absolutely necessary.**

Use the **current Paradox Agent Town as the base** and progressively improve it.

The goal is to make the current town feel much more like a polished, living **AI-agent simulation game**, inspired by the provided reference Agent Town image.

Preserve the current visual identity and structure while upgrading the environment, agent characters, animations, navigation, and interaction system.

---

# 1. EXISTING TOWN MUST REMAIN

Keep the current:

- Town layout
- Existing rooms
- Existing furniture
- Existing workstations
- Existing agents
- Existing agent names
- Existing UI/header
- Town / Map / List navigation
- Existing functionality
- Existing colors and Paradox branding
- Existing camera/view
- Existing agent status system

Only improve and extend them.

If something already works, **do not replace it with a completely different implementation just for visual reasons.**

Use incremental changes.

---

# 2. VISUAL DIRECTION

Use the provided reference Agent Town as inspiration for:

- Dense office environment
- Small rooms
- Individual agent work areas
- Detailed furniture
- Top-down/isometric game-like perspective
- Pixel-art-inspired visuals
- Living environment
- Small environmental details
- Clear walking routes
- Agents interacting with the environment

However, the result must remain recognizably **Paradox Agent Town**.

Do not copy branding from the reference.

Keep the Paradox futuristic dark interface.

The town should feel like:

> **A futuristic AI company where autonomous AI agents live, work, communicate and execute tasks.**

---

# 3. ADD INDIVIDUAL AGENT CABINS

Add a dedicated **cabin/workstation area for each agent** inside the EXISTING town.

Do not create a completely separate town.

Integrate the cabins naturally into the current building.

Each cabin should feel like the agent's personal workspace.

Example:

```text
┌──────────────┐
│   AGENT      │
│   CABIN      │
│              │
│   🖥️ DESK    │
│      🪑      │
│              │
│   AGENT      │
└──────┬───────┘
       │
═══════╪════════ MAIN PATH
       │
```

Each cabin can contain:

- Desk
- Computer/monitor
- Chair
- Small storage area
- Agent-specific decorations
- Small plant
- Status light
- Personal screen
- Agent name/sign
- Task indicator

Keep cabins visually consistent but give each agent small differences.

For example:

- Different desk decorations
- Different monitor content
- Different plant/object
- Different accent details
- Different workstation status

---

# 4. AGENT CHARACTER DESIGN

Improve the existing agents rather than replacing their identity.

Make agents more:

- Cartoon-like
- Cute
- Polished
- Expressive
- Readable
- Game-like

Each agent must have:

- Head
- Body
- Two arms
- Two separate legs
- Hands
- Feet
- Distinct outfit
- Individual appearance

Keep the current agent names and identities.

---

# 5. REAL WALKING ANIMATION

Agents must NOT slide across the floor.

Implement an actual walking animation.

Walking cycle:

```text
STEP 1
Left leg forward
Right leg backward
Right arm forward
Left arm backward

STEP 2
Right leg forward
Left leg backward
Left arm forward
Right arm backward
```

Add:

- Slight body bounce
- Foot movement
- Arm swing
- Natural transition between steps
- Smooth acceleration
- Smooth deceleration

The animation should adapt to movement speed.

When the agent stops:

```text
WALKING
   ↓
DECELERATE
   ↓
IDLE
```

Never abruptly freeze the walking animation.

---

# 6. AGENT HAND MOVEMENT

Agents should have independent arm/hand animations.

While walking:

- Arms swing naturally.

While working:

- Hands move toward the keyboard.
- Agent can type.
- Small head movement.
- Occasional monitor interaction.

While thinking:

- Hand can move toward chin/head.
- Small thinking animation.

While communicating:

- Small hand gestures.

This should make the agents feel alive rather than like static sprites.

---

# 7. SITTING SYSTEM

Agents must actually sit on their cabin/workstation chairs.

Sequence:

```text
MAIN PATH
   ↓
CABIN ENTRANCE
   ↓
WORKSTATION
   ↓
CHAIR
   ↓
SIT ANIMATION
   ↓
WORKING
```

The agent should:

1. Walk to the cabin.
2. Follow the navigation path.
3. Approach the chair from the correct direction.
4. Stop at the chair interaction point.
5. Orient toward the chair.
6. Play a sitting animation.
7. Move into the correct sitting position.
8. Sit on the chair.
9. Work at the computer.
10. Animate hands while working.
11. Eventually stand up.
12. Return to the main path.

DO NOT teleport agents into chairs.

---

# 8. SINGLE MAIN WALKING PATH

This is extremely important.

All agents should use a **single controlled main path** through the town.

The town should have a central route similar to:

```text
             CABIN
               │
               │
CABIN ───── MAIN PATH ───── CABIN
               │
               │
            JUNCTION
               │
        OTHER TOWN AREA
```

The main path should be represented internally using:

- Waypoints
- Nodes
- Navigation points

Agents should travel between these points.

Example:

```text
Spawn
  ↓
Waypoint A
  ↓
Waypoint B
  ↓
Junction
  ↓
Cabin Entrance
  ↓
Chair Interaction Point
```

Agents should NOT freely wander anywhere.

---

# 9. CABIN PATH RULE

Agents can leave the main path only when entering their own cabin.

Example:

```text
              CABIN
                ↑
                │
MAIN PATH ──────┘
```

Once the agent finishes working:

```text
CHAIR
 ↓
CABIN EXIT
 ↓
MAIN PATH
```

This prevents chaotic movement.

---

# 10. COLLISION / OBJECT AWARENESS

Agents must never walk through:

- Walls
- Desks
- Chairs
- Computers
- Plants
- Cabinets
- Other solid furniture

The navigation system must understand walkable and non-walkable areas.

If another agent is blocking the path:

- Slow down
- Wait briefly
- Or use a small controlled avoidance behavior

But do not create random wandering.

---

# 11. AGENT STATE MACHINE

Use a proper state machine.

Recommended states:

```text
IDLE
THINKING
WALKING
ARRIVING
ENTERING_CABIN
SITTING
WORKING
INTERACTING
COMMUNICATING
STANDING
EXITING_CABIN
WAITING
COMPLETED
ERROR
```

Example:

```text
IDLE
 ↓
TASK_ASSIGNED
 ↓
WALKING
 ↓
ENTERING_CABIN
 ↓
SITTING
 ↓
WORKING
 ↓
TASK_COMPLETED
 ↓
STANDING
 ↓
EXITING_CABIN
 ↓
WALKING
 ↓
IDLE
```

---

# 12. LIVING TOWN EFFECT

The town should feel alive even when no task is running.

Agents can:

- Sit at their computers
- Stand and think
- Walk between areas
- Check monitors
- Communicate
- Wait for tasks
- Return to cabins
- Move around the main path

Use subtle idle animations.

Do not make every agent move constantly.

Movement should feel purposeful.

---

# 13. AGENT-SPECIFIC CABINS

Make cabins feel connected to the agent's role.

For example:

### Research Agent

- Books/data screens
- Research monitor
- Notes
- Documents

### Coding Agent

- Multiple monitors
- Terminal/code screen
- Keyboard
- Technical decorations

### Analytics Agent

- Charts
- Data dashboards
- Graph screens

### Communication Agent

- Communication monitor
- Chat indicators
- Headset

These are visual representations only and should not interfere with the existing functionality.

---

# 14. CURRENT UI MUST STAY

Do not remove the existing:

- Header
- Agent Town title
- Navigation
- Town / Map / List tabs
- Agent labels
- Status indicators
- Existing controls

Improve their visual polish where appropriate.

The town remains the primary focus.

---

# 15. PARADOX BRANDING

Maintain the existing Paradox identity.

Use:

- Dark futuristic environment
- Cyan/teal accents
- Subtle glowing elements
- Modern typography
- Minimal HUD
- Professional AI aesthetic

Avoid making the entire interface look like a generic pixel-art game.

The **world can be game-like**, while the surrounding UI remains futuristic and professional.

---

# 16. PERFORMANCE

The town must remain smooth.

Important:

- Avoid unnecessary re-rendering.
- Avoid expensive animations on every object.
- Use efficient sprite/DOM/canvas techniques appropriate to the current implementation.
- Keep animation smooth on normal Windows computers.
- Do not sacrifice existing functionality for visual effects.

The walking system should remain stable with multiple agents active simultaneously.

---

# 17. RESPONSIVENESS

The town should work correctly across:

- Windows desktop
- Different screen resolutions
- Different monitor sizes
- Different browser sizes

Do not hardcode the entire world to one resolution.

The camera/world should scale appropriately.

---

# 18. IMPLEMENTATION APPROACH

Before changing anything:

1. Inspect the existing Agent Town code.
2. Understand the current rendering system.
3. Understand how agents are currently represented.
4. Understand the current movement system.
5. Understand the existing UI.
6. Reuse existing components wherever possible.
7. Make incremental changes.
8. Test after each major change.

Do NOT blindly replace existing files.

Do NOT delete working functionality.

Do NOT redesign unrelated parts of Paradox.

---

# 19. PRIORITY ORDER

Implement improvements in this order:

### Priority 1
Preserve the existing town.

### Priority 2
Add agent cabins/workstations.

### Priority 3
Create the single main navigation path.

### Priority 4
Improve agent character visuals.

### Priority 5
Implement real two-leg walking.

### Priority 6
Implement arm/hand movement.

### Priority 7
Implement sitting/standing.

### Priority 8
Implement working-at-computer animations.

### Priority 9
Add subtle environmental details.

### Priority 10
Polish the UI and animations.

---

# 20. FINAL RESULT

The final Agent Town should look like an evolved version of the current Paradox town:

```text
CURRENT PARADOX TOWN
        +
REFERENCE AGENT TOWN STYLE
        +
CARTOON AGENTS
        +
INDIVIDUAL AGENT CABINS
        +
REAL WALKING PHYSICS
        +
SITTING / WORKING
        +
SINGLE CONTROLLED PATH
        =
POLISHED PARADOX AGENT TOWN
```

The most important principle:

> **IMPROVE THE CURRENT TOWN. DO NOT REPLACE IT.**

The user should immediately recognize the existing Paradox Agent Town after the update, but it should feel significantly more alive, polished, detailed and game-like.
