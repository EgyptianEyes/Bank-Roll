const input = document.querySelector("[data-document-search]");
const status = document.querySelector("[data-document-search-status]");
const emptyState = document.querySelector("[data-document-empty]");
const entries = [...document.querySelectorAll("[data-searchable]")];
const groups = [...document.querySelectorAll("[data-document-group]")];
const navigationLinks = [...document.querySelectorAll(".knowledge-sidebar a, .knowledge-index a")];

if (input && status){
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const entry of entries){
      const matches = !query || entry.textContent.toLocaleLowerCase().includes(query);
      entry.hidden = !matches;
      if (matches) visible++;
    }
    for (const group of groups){
      const hasVisibleEntry = group.querySelector("[data-searchable]:not([hidden])");
      group.hidden = Boolean(query) && !hasVisibleEntry;
    }
    for (const link of navigationLinks){
      const target = link.getAttribute("href")?.startsWith("#") ? document.getElementById(link.getAttribute("href").slice(1)) : null;
      link.hidden = Boolean(query) && Boolean(target?.hidden);
    }
    if (emptyState) emptyState.hidden = visible !== 0;
    status.textContent = query ? `${visible} matching item${visible === 1 ? "" : "s"}` : `${entries.length} topics`;
  });
  status.textContent = `${entries.length} topics`;
}
