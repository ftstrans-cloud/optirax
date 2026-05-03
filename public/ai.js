// ===== RAPORT AI (JEDYNA WERSJA) =====
async function generateReport(){
  const aiReportEl = document.getElementById("aiReport");
  if (!aiReportEl) {
    console.error("Brak elementu #aiReport w HTML");
    return;
  }

  if (!window.lastCalc || !window.lastInput) {
    aiReportEl.textContent = "Najpierw kliknij POLICZ.";
    return;
  }

  aiReportEl.textContent = "Generuję raport...";

  const payload = {
    note: "Kalkulacja",
    input: window.lastInput,
    calc: window.lastCalc
  };

  try {
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let data = {};
try {
  data = await res.json();
} catch (e) {
  console.error("JSON parse error", e);
}
	 console.log("ROUTE DATA:", data); 
	
	if(data.margin !== undefined){

  const marginEl = document.getElementById("marginValue");
  const costEl = document.getElementById("costValue");
  const scoreEl = document.getElementById("routeScore");

  if(marginEl) marginEl.textContent = Math.round(data.margin);
  if(costEl) costEl.textContent = Math.round(data.total_cost);

  if(scoreEl && data.score){
    scoreEl.textContent = data.score.label;
    scoreEl.style.color = data.score.color;
  }

  const box = document.querySelector(".route-evaluation");
  if(box && data.score){
    box.style.borderColor = data.score.color;
  }
}

    if (!res.ok) {
      aiReportEl.textContent =
        (data.error || "Błąd serwera.") +
        (data.gotKeys ? ("\n\ngotKeys: " + data.gotKeys.join(", ")) : "");
      return;
    }

    aiReportEl.innerText = data.report || "(brak treści raportu)";
  } catch (e) {
    console.error("REPORT FETCH ERROR:", e);
    aiReportEl.textContent =
      "Nie mogę połączyć się z serwerem. Czy działa http://localhost:3001 ?";
  }
}

window.generateReport = generateReport;