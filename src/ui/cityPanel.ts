import { LABOUR_PARTICIPATION } from '../data/balance';
import { STR } from '../data/strings.tr';
import { uiStore } from '../state/store';

/**
 * The city's books, always on screen.
 *
 * Everything here was already being computed and thrown away: the ledger splits
 * income from road upkeep from station upkeep, the building pass totals housing
 * and jobs, and the player saw one net figure that explained none of it. A city
 * builder is a game about numbers moving, and numbers the player cannot see are
 * not gameplay.
 *
 * It stays translucent at every size. The city is what the player is looking
 * at, and a panel that blanks out the district under it to show a figure about
 * that district is working against itself — so the background is a blur, never
 * a fill, and collapsed it is three lines rather than a wall.
 */
export interface CityPanelHandle {
  dispose(): void;
}

const OPEN_KEY = 'kadastro.panelOpen';

function rememberedOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    /* the panel opening in its default state is not a failure worth handling */
  }
}

export function mountCityPanel(root: HTMLElement): CityPanelHandle {
  const panel = document.createElement('section');
  panel.className = 'city-panel';
  panel.dataset['open'] = String(rememberedOpen());

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'panel-toggle';
  toggle.setAttribute('aria-expanded', panel.dataset['open'] ?? 'false');

  const summary = document.createElement('div');
  summary.className = 'panel-summary';
  const summaryPeople = statLine();
  const summaryNet = statLine();
  const summaryJobs = statLine();
  summary.append(summaryPeople.row, summaryNet.row, summaryJobs.row);

  const chevron = document.createElement('span');
  chevron.className = 'panel-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '⌃';

  toggle.append(summary, chevron);

  const detail = document.createElement('div');
  detail.className = 'panel-detail';

  const people = section(STR.panel.people);
  const housing = row(STR.panel.housing);
  const vacancy = row(STR.panel.vacancy);
  const workers = row(STR.panel.workers);
  const unemployment = row(STR.panel.unemployment);
  people.body.append(housing.el, vacancy.el, workers.el, unemployment.el);

  const books = section(STR.panel.books);
  const tax = row(STR.panel.tax);
  const roads = row(STR.panel.roads);
  const stations = row(STR.panel.stations);
  const plants = row(STR.panel.plants);
  const net = row(STR.panel.net, true);
  books.body.append(tax.el, roads.el, stations.el, plants.el, net.el);

  // Hidden until the era expects utilities at all, so a village is not shown a
  // shortfall in a system it is not meant to have.
  const grid = section(STR.panel.gridTitle);
  const water = row(STR.panel.water);
  const power = row(STR.panel.power);
  grid.body.append(water.el, power.el);

  const trade = section(STR.panel.demandTitle);
  const demandRes = row(STR.zone.res);
  const demandCom = row(STR.zone.com);
  const demandInd = row(STR.zone.ind);
  const farms = row(STR.panel.farmYield);
  trade.body.append(demandRes.el, demandCom.el, demandInd.el, farms.el);

  detail.append(people.el, books.el, grid.el, trade.el);
  panel.append(toggle, detail);
  root.append(panel);

  toggle.addEventListener('click', () => {
    const open = panel.dataset['open'] !== 'true';
    panel.dataset['open'] = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    remember(open);
  });

  const money = STR.format.money;
  const count = STR.format.count;

  const paint = (): void => {
    const s = uiStore.getState();
    const t = s.totals;
    const jobs = t.commercialJobs + t.industrialJobs + t.farmJobs;
    const workforce = s.population * LABOUR_PARTICIPATION;
    const idle = workforce > 0 ? Math.max(0, (workforce - jobs) / workforce) : 0;
    const empty = Math.max(0, t.housing - s.population);

    summaryPeople.set(STR.panel.people, count(s.population));
    summaryNet.set(STR.panel.net, STR.hud.net(s.net));
    summaryNet.row.dataset['sign'] = s.net >= 0 ? 'positive' : 'negative';
    summaryJobs.set(STR.panel.jobs, count(jobs));

    housing.set(count(t.housing));
    vacancy.set(count(empty));
    workers.set(count(workforce));
    unemployment.set(STR.format.percent(idle));
    // Unemployment is the number that quietly stalls a city, so it says so.
    unemployment.el.dataset['alarm'] = String(idle > 0.35 && s.population > 30);

    tax.set(`+${money(s.ledger.taxIncome)}`);
    roads.set(`−${money(s.ledger.roadUpkeep)}`);
    stations.set(`−${money(s.ledger.serviceUpkeep)}`);
    plants.set(`−${money(s.ledger.utilityUpkeep)}`);
    net.set(STR.hud.net(s.net));
    net.el.dataset['sign'] = s.net >= 0 ? 'positive' : 'negative';

    grid.el.hidden = !s.grid.expected;
    water.set(STR.panel.supply(s.grid.waterSupply, s.grid.waterDemand));
    // A grid that cannot meet demand serves nobody, so the shortfall is the
    // whole story rather than a percentage.
    water.el.dataset['alarm'] = String(s.grid.waterSupply < s.grid.waterDemand);
    power.set(STR.panel.supply(s.grid.powerSupply, s.grid.powerDemand));
    power.el.dataset['alarm'] = String(s.grid.powerSupply < s.grid.powerDemand);

    demandRes.set(STR.format.percent(s.demand.res));
    demandCom.set(STR.format.percent(s.demand.com));
    demandInd.set(STR.format.percent(s.demand.ind));
    farms.set(count(s.ledger.farmYield));
  };

  paint();
  const unsubscribe = uiStore.subscribe(paint);

  return {
    dispose: () => {
      unsubscribe();
      panel.remove();
    },
  };
}

interface StatLine {
  row: HTMLElement;
  set(label: string, value: string): void;
}

function statLine(): StatLine {
  const el = document.createElement('div');
  el.className = 'panel-stat';
  const label = document.createElement('span');
  label.className = 'panel-stat-label';
  const value = document.createElement('span');
  value.className = 'panel-stat-value mono';
  el.append(label, value);
  return {
    row: el,
    set: (l, v) => {
      if (label.textContent !== l) label.textContent = l;
      if (value.textContent !== v) value.textContent = v;
    },
  };
}

interface Section {
  el: HTMLElement;
  body: HTMLElement;
}

function section(title: string): Section {
  const el = document.createElement('div');
  el.className = 'panel-section';
  const heading = document.createElement('h2');
  heading.className = 'panel-heading';
  heading.textContent = title;
  const body = document.createElement('div');
  body.className = 'panel-rows';
  el.append(heading, body);
  return { el, body };
}

interface Row {
  el: HTMLElement;
  set(value: string): void;
}

function row(label: string, strong = false): Row {
  const el = document.createElement('div');
  el.className = strong ? 'panel-row strong' : 'panel-row';
  const name = document.createElement('span');
  name.textContent = label;
  const value = document.createElement('span');
  value.className = 'panel-value mono';
  el.append(name, value);
  return {
    el,
    set: (v) => {
      if (value.textContent !== v) value.textContent = v;
    },
  };
}
