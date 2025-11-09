<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<template>
  <header class="navbar">
    <div class="navbar-container">
      <div class="navbar-brand">
        <img alt="Vue logo" class="logo" src="@/assets/logo.svg" width="40" height="40" />
        <h1>CAD Pre-Alerts</h1>
      </div>
      <nav>
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/about">About</RouterLink>
        <RouterLink to="/settings">Settings</RouterLink>
      </nav>
    </div>
  </header>

  <RouterView />
</template>

<style scoped>
.navbar {
  background: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  position: sticky;
  top: 0;
  z-index: 100;
}

.navbar-container {
  /* max-width: 1400px; */
  margin: 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  gap: 2rem;
}

.navbar-brand {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.logo {
  display: block;
}

h1 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--color-heading);
  white-space: nowrap;
}

nav {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

nav a {
  padding: 0.5rem 1rem;
  border-radius: 4px;
  text-decoration: none;
  color: var(--color-text);
  font-weight: 500;
  transition: background-color 0.2s ease;
  white-space: nowrap;
}

nav a:hover {
  background-color: var(--color-background-mute);
}

nav a.router-link-exact-active {
  background-color: hsla(160, 100%, 37%, 0.1);
  color: hsla(160, 100%, 37%, 1);
}

nav a.router-link-exact-active:hover {
  background-color: hsla(160, 100%, 37%, 0.15);
}

@media (max-width: 768px) {
  .navbar-container {
    flex-direction: column;
    align-items: flex-start;
    padding: 1rem;
  }

  h1 {
    font-size: 1.25rem;
  }

  nav {
    width: 100%;
    justify-content: flex-start;
  }

  nav a {
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }
}
</style>
