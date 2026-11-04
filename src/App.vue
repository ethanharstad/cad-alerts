<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { BellRing, Info, Settings } from 'lucide-vue-next'
import icon from '@scene-ready/design-system/assets/scene-ready-icon.svg'
import iconReversed from '@scene-ready/design-system/assets/scene-ready-icon-reversed.svg'
</script>

<template>
  <header class="topbar">
    <div class="topbar-inner">
      <RouterLink to="/" class="brand">
        <!-- The reversed mark is for dark surfaces; CSS shows the one that fits. -->
        <img class="brand-mark brand-mark-light" :src="icon" alt="" width="32" height="32" />
        <img class="brand-mark brand-mark-dark" :src="iconReversed" alt="" width="32" height="32" />
        <span class="brand-text">
          <span class="brand-eyebrow">Scene Ready</span>
          <span class="brand-name">CAD Pre-Alerts</span>
        </span>
      </RouterLink>
      <nav aria-label="Main">
        <RouterLink to="/" class="nav-link"><BellRing aria-hidden="true" />Alerts</RouterLink>
        <RouterLink to="/settings" class="nav-link"><Settings aria-hidden="true" />Settings</RouterLink>
        <RouterLink to="/about" class="nav-link"><Info aria-hidden="true" />About</RouterLink>
      </nav>
    </div>
  </header>

  <RouterView />
</template>

<style scoped>
/* Top bar per BRANDING.md › Application Shell: 64px, card surface, bottom border. */
.topbar {
  position: sticky;
  top: 0;
  z-index: 100;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
}

.topbar-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-6);
  min-height: var(--topbar-height);
  padding: 0 var(--space-6);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  color: inherit;
  text-decoration: none;
  border-radius: var(--radius-md);
}

.brand-mark {
  display: block;
}

.brand-mark-dark,
[data-theme='dark'] .brand-mark-light {
  display: none;
}

[data-theme='dark'] .brand-mark-dark {
  display: block;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand-eyebrow {
  color: var(--text-secondary);
  font-family: var(--font-condensed);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.brand-name {
  color: var(--text-brand);
  font-size: var(--text-xl);
  font-weight: 600;
  white-space: nowrap;
}

nav {
  display: flex;
  align-items: stretch;
  align-self: stretch;
  gap: var(--space-1);
}

/* Mirrors the sidebar nav item: muted until hovered, accent edge when active. */
.nav-link {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 0 var(--space-4);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
  border-bottom: 3px solid transparent;
  border-top: 3px solid transparent;
  transition:
    color var(--duration-fast) var(--ease-out),
    background-color var(--duration-fast) var(--ease-out);
}

.nav-link svg {
  width: 20px;
  height: 20px;
}

.nav-link:hover {
  color: var(--text-brand);
  background: var(--bg-hover);
}

.nav-link.router-link-exact-active {
  color: var(--text-brand);
  border-bottom-color: var(--accent);
}

@media (max-width: 640px) {
  .topbar-inner {
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: var(--space-3) var(--space-4) 0;
  }

  nav {
    min-height: 44px;
  }

  .nav-link {
    flex: 1;
    justify-content: center;
    padding: 0 var(--space-2);
  }
}
</style>
