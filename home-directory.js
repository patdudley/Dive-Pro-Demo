(function () {
  const BUBBLE_COPY = {
    "la-jolla": { name: "La Jolla", place: "San Diego" },
    monterey: { name: "Monterey", place: "Monterey Bay" },
    "catalina-wrigley": { name: "Catalina Wrigley", place: "Catalina Island" },
    "anacapa-ocean": { name: "Anacapa", place: "Channel Islands" },
  };

  let laJollaGrade = null;

  function californiaSpots() {
    if (typeof window.californiaSpots === "function") return window.californiaSpots();
    return (window.outdoorSpots || []).filter((spot) => spot.regionGroup === "California");
  }

  function gradeClass(grade) {
    return `grade-${String(grade || "").toLowerCase().replace("+", "-plus")}`;
  }

  function spotHaystack(spot) {
    const copy = BUBBLE_COPY[spot.slug] || {};
    return [copy.name, copy.place, spot.name, spot.pickerLabel, spot.city, spot.location]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function bubbleCard(spot) {
    const copy = BUBBLE_COPY[spot.slug] || { name: spot.name, place: spot.city || spot.location || "" };
    const card = document.createElement("a");
    card.className = "spot-bubble";
    card.href = spot.href;
    card.dataset.slug = spot.slug;
    card.setAttribute("aria-label", `Open ${copy.name}`);

    const grade = spot.slug === "la-jolla" && laJollaGrade ? laJollaGrade : null;
    const gradeMarkup = grade
      ? `<div class="spot-bubble-grade ${gradeClass(grade.letter)}"><b>${grade.letter}</b>${grade.range ? `<span>${grade.range}</span>` : ""}</div>`
      : "";

    card.innerHTML = `
      <div class="spot-bubble-copy">
        <h2>${copy.name}</h2>
        <p>${copy.place}</p>
      </div>
      ${gradeMarkup}
    `;
    return card;
  }

  function renderBubbles(spots, query = "") {
    const list = document.getElementById("spotBubbles");
    const empty = document.getElementById("spotSearchEmpty");
    if (!list) return;
    const q = query.trim().toLowerCase();
    const visible = spots.filter((spot) => !q || spotHaystack(spot).includes(q));
    list.replaceChildren(...visible.map(bubbleCard));
    if (empty) empty.hidden = visible.length > 0;
  }

  function jumpToBestMatch(spots, query) {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const matches = spots.filter((spot) => spotHaystack(spot).includes(q));
    const exact = matches.find((spot) => {
      const copy = BUBBLE_COPY[spot.slug] || {};
      return [copy.name, spot.pickerLabel, spot.name, spot.city]
        .some((value) => String(value || "").toLowerCase() === q);
    });
    const target = exact || (matches.length === 1 ? matches[0] : null);
    if (target?.href) window.location.assign(target.href);
  }

  async function loadLaJollaGrade() {
    try {
      const response = await fetch("model_outputs/latest_forecast.json", { cache: "no-store" });
      if (!response.ok) return;
      const forecast = await response.json();
      const letter = String(forecast.grade || "").trim().toUpperCase();
      if (!letter) return;
      const range = forecast.estimated_visibility_range_ft;
      laJollaGrade = {
        letter,
        range: Array.isArray(range) && range.length >= 2 ? `${range[0]}-${range[1]} ft` : "",
      };
    } catch {
      laJollaGrade = null;
    }
  }

  function initHomeDirectory() {
    const spots = californiaSpots().slice(0, 4);
    const form = document.getElementById("spotSearchForm");
    const input = document.getElementById("spotSearch");
    renderBubbles(spots, input?.value || "");
    loadLaJollaGrade().then(() => renderBubbles(spots, input?.value || ""));
    input?.addEventListener("input", () => renderBubbles(spots, input.value));
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      jumpToBestMatch(spots, input?.value || "");
    });
  }

  initHomeDirectory();
}());
