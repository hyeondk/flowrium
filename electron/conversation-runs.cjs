// Preserve the native run as the primary entry for callers that manage Codex.
// A second entry is possible only when the two services run side by side.
class ConversationRuns extends Map {
  #claude = new Map();

  forProvider(id, provider) {
    const run = this.get(id);
    if ((run?.provider || 'codex') === provider) return run;
    return provider === 'claude' ? this.#claude.get(id) : undefined;
  }

  owns(run) { return this.forProvider(run.sessionId, run.provider || 'codex') === run; }

  set(id, run) {
    const existing = this.get(id);
    if (!existing || (existing.provider || 'codex') === (run.provider || 'codex')) super.set(id,run);
    else if (run.provider === 'claude') this.#claude.set(id,run);
    else { this.#claude.set(id,existing); super.set(id,run); }
    return this;
  }

  remove(run) {
    const id=run.sessionId;
    if (this.#claude.get(id) === run) this.#claude.delete(id);
    else if (this.get(id) === run) {
      const remaining=this.#claude.get(id);
      if (remaining) { super.set(id,remaining);this.#claude.delete(id); }
      else super.delete(id);
    }
  }

  delete(id) { this.#claude.delete(id);return super.delete(id); }
  clear() { this.#claude.clear();super.clear(); }
  *values() { yield* super.values();yield* this.#claude.values(); }
  providers(id) { return ['codex','claude'].filter(provider=>this.forProvider(id,provider)); }
}

module.exports={ConversationRuns};
