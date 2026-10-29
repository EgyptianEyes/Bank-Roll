export class RouletteBoard{
  constructor(container, {isRed, streetOf, fromMinorUnits}){
    this.container = container;
    this.isRed = isRed;
    this.streetOf = streetOf;
    this.fromMinorUnits = fromMinorUnits;
    this.streetCells = [];
    this.numberCells = new Array(37);
    this.lastWinningCell = null;
    this.lastWinningStreet = null;
    this.lastStreetKey = "";
  }

  build(){
    if (!this.container) return;
    this.container.innerHTML = "";
    this.container.classList.add("roulette-table");
    this.streetCells.length = 0;

    const zero = document.createElement("div");
    zero.className = "zero-cell";
    zero.textContent = "0";
    this.numberCells[0] = zero;

    const numberGrid = document.createElement("div");
    numberGrid.className = "number-grid";
    for (let row = 0; row < 3; row++){
      for (let col = 0; col < 12; col++){
        const number = col * 3 + (3 - row);
        const cell = document.createElement("div");
        cell.className = "number-cell";
        if (number !== 0) cell.classList.add(this.isRed(number) ? "red" : "black");
        if (row < 2) cell.classList.add("faded");
        cell.textContent = String(number);
        this.numberCells[number] = cell;
        numberGrid.appendChild(cell);
      }
    }

    const chipLayer = document.createElement("div");
    chipLayer.className = "street-chip-layer";
    for (let col = 0; col < 12; col++){
      const holder = document.createElement("div");
      holder.className = "street-chip-holder";
      holder.style.gridColumn = String(col + 1);
      holder.style.gridRow = "3";
      chipLayer.appendChild(holder);
      this.streetCells.push({holder});
    }
    this.container.append(zero, numberGrid, chipLayer);
  }

  clearChips(){
    for (const entry of this.streetCells) entry.holder.innerHTML = "";
  }

  highlightWinningStreet(street){
    if (this.lastWinningStreet){
      for (const cell of this.lastWinningStreet) cell.classList.remove("street-winner");
    }
    this.lastWinningStreet = null;
    if (street === null) return;

    const first = street * 3 + 1;
    const cells = [];
    for (let number = first; number <= first + 2; number++){
      const cell = this.numberCells[number];
      if (cell){
        cell.classList.add("street-winner");
        cells.push(cell);
      }
    }
    this.lastWinningStreet = cells;
  }

  highlightWinningNumber(number){
    if (this.lastWinningCell) this.lastWinningCell.classList.remove("winner");
    this.highlightWinningStreet(this.streetOf(number));
    const cell = this.numberCells[number];
    if (cell){
      cell.classList.add("winner");
      this.lastWinningCell = cell;
    } else {
      this.lastWinningCell = null;
    }
  }

  updateBets(wager){
    if (!this.streetCells.length) return;
    if (!wager || wager.kind !== "streets"){
      this.lastStreetKey = "";
      this.clearChips();
      return;
    }

    const stakes = wager.streetStakeCents || wager.chosen.map(() => wager.perStreetStakeCents);
    const key = `${[...wager.chosen].sort((a, b) => a - b).join(",")}|${stakes.join(",")}|${wager.stakeUnits}`;
    if (key === this.lastStreetKey) return;
    this.lastStreetKey = key;
    this.clearChips();
    const count = Math.max(1, Math.floor(wager.stakeUnits));

    for (const [index, street] of wager.chosen.entries()){
      const entry = this.streetCells[street];
      if (!entry) continue;
      const amount = this.fromMinorUnits(stakes[index]);
      const label = amount < 1 ? `${Math.round(amount * 100)}p` : `£${amount.toFixed(2).replace(/\.00$/, "")}`;
      const stack = document.createElement("div");
      stack.className = "street-chip-stack";
      for (let index = 0; index < count; index++){
        const chip = document.createElement("div");
        chip.className = "street-chip";
        chip.style.bottom = `${index * 4}px`;
        if (index === count - 1) chip.textContent = label;
        stack.appendChild(chip);
      }
      entry.holder.appendChild(stack);
    }
  }

  reset(){
    this.lastStreetKey = "";
    this.clearChips();
    if (this.lastWinningCell) this.lastWinningCell.classList.remove("winner");
    this.lastWinningCell = null;
    if (this.lastWinningStreet){
      for (const cell of this.lastWinningStreet) cell.classList.remove("street-winner");
    }
    this.lastWinningStreet = null;
  }
}