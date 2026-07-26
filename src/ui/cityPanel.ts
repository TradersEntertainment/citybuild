import { LABOUR_PARTICIPATION } from '../data/balance';
import { STR } from '../data/strings.tr';
import { uiStore, type MissionView } from '../state/store';
import { describeGoal } from './missionText';

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

export interface CityPanelDeps {
  /** Opens the retire card; the panel never destroys anything itself. */
  onRetire(): void;
}

export function mountCityPanel(root: HTMLElement, deps: CityPanelDeps): CityPanelHandle {
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
  const transit = row(STR.panel.transit);
  const farmIncome = row(STR.panel.farmIncome);
  const sea = row(STR.seaIncome);
  const visiting = row(STR.visitorIncome);
  const roads = row(STR.panel.roads);
  const stations = row(STR.panel.stations);
  const plants = row(STR.panel.plants);
  const debt = row(STR.panel.debt);
  const net = row(STR.panel.net, true);
  books.body.append(
    tax.el,
    transit.el,
    visiting.el,
    sea.el,
    farmIncome.el,
    roads.el,
    stations.el,
    plants.el,
    debt.el,
    net.el,
  );

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

  // Goals first: a player who opens the panel wanting to know what to do next
  // should not have to read four sections of bookkeeping to find out.
  const goals = section(STR.mission.title);
  const goalCount = document.createElement('span');
  goalCount.className = 'panel-heading-count mono';
  goals.el.querySelector('.panel-heading')?.append(goalCount);
  const goalRows = document.createElement('div');
  goalRows.className = 'mission-rows';
  goals.body.append(goalRows);

  // Every section goes inside one wrapper, and the wrapper is the detail's only
  // child. The collapse is a grid animating its single row from 0fr to 1fr, and
  // a grid with five children puts four of them in *implicit* rows that
  // grid-template-rows does not size — so the panel was only ever collapsing
  // its first section and showing the rest, which is the opposite of a panel
  // that stays out of the way until it is asked for.
  const inner = document.createElement('div');
  inner.className = 'panel-detail-inner';
  inner.append(goals.el, people.el, books.el, grid.el, trade.el);
  // Retiring lives at the bottom of the panel, below every number it is a
  // decision about, and does not exist at all until the city is old enough for
  // it to be one. A destructive action a new player can reach by accident is
  // not a feature.
  const legacy = section(STR.legacy.title);
  const legacyHeld = document.createElement('span');
  legacyHeld.className = 'panel-heading-count mono';
  legacy.el.querySelector('.panel-heading')?.append(legacyHeld);
  const retire = document.createElement('button');
  retire.type = 'button';
  retire.className = 'panel-action';
  retire.textContent = STR.legacy.action;
  retire.addEventListener('click', () => deps.onRetire());
  const locked = document.createElement('p');
  locked.className = 'mission-empty';
  locked.textContent = STR.legacy.locked;
  legacy.body.append(retire, locked);
  inner.append(legacy.el);

  detail.append(inner);
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

  /**
   * Goals are rebuilt wholesale, which is safe because the store only publishes
   * a new list when a reading actually moved — and because there are three of
   * them, not three hundred.
   */
  const paintGoals = (s: ReturnType<typeof uiStore.getState>): void => {
    goalCount.textContent = STR.mission.done(s.missionsDone, s.missionsTotal);
    goalRows.textContent = '';
    if (s.missions.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'mission-empty';
      empty.textContent = STR.mission.none;
      goalRows.append(empty);
      return;
    }
    for (const view of s.missions) goalRows.append(missionRow(view));
  };

  const paint = (): void => {
    const s = uiStore.getState();
    const t = s.totals;
    paintGoals(s);
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
    // Income sources that are zero stay hidden: a village with no junction yet
    // should not read a row about money it has no way to make.
    transit.el.hidden = s.ledger.transitIncome <= 0;
    transit.set(`+${money(s.ledger.transitIncome)}`);
    // Hidden until there is a waterfront, like the corridor and the harvest: an
    // inland city is not shown a row it can never fill.
    // Hidden until the corridor actually brings anybody in: an unconnected city
    // is not shown a line it cannot fill.
    visiting.el.hidden = s.ledger.visitorIncome <= 0;
    visiting.set(`+${money(s.ledger.visitorIncome)}`);
    sea.el.hidden = s.ledger.seaIncome <= 0;
    sea.set(`+${money(s.ledger.seaIncome)}`);
    farmIncome.el.hidden = s.ledger.farmIncome <= 0;
    farmIncome.set(`+${money(s.ledger.farmIncome)}`);
    roads.set(`−${money(s.ledger.roadUpkeep)}`);
    stations.set(`−${money(s.ledger.serviceUpkeep)}`);
    plants.set(`−${money(s.ledger.utilityUpkeep)}`);
    // Hidden when there is nothing owed, so a city with no loans is not shown a
    // row of zeroes about a system it has not met.
    debt.el.hidden = s.debt <= 0;
    debt.set(`−${money(s.ledger.debtService)}`);
    debt.el.dataset['alarm'] = 'true';
    net.set(STR.hud.net(s.net));
    net.el.dataset['sign'] = s.net >= 0 ? 'positive' : 'negative';

    grid.el.hidden = !s.grid.expected;
    water.set(STR.panel.supply(s.grid.waterSupply, s.grid.waterDemand));
    // A grid that cannot meet demand serves nobody, so the shortfall is the
    // whole story rather than a percentage.
    water.el.dataset['alarm'] = String(s.grid.waterSupply < s.grid.waterDemand);
    power.set(STR.panel.supply(s.grid.powerSupply, s.grid.powerDemand));
    power.el.dataset['alarm'] = String(s.grid.powerSupply < s.grid.powerDemand);

    // The row exists only once retiring is possible, and the held total only
    // once there is one — a zero here would be advertising a system the player
    // has no way to use yet.
    retire.hidden = !s.canRetire;
    locked.hidden = s.canRetire;
    legacyHeld.textContent = s.legacy > 0 ? STR.legacy.held(s.legacy) : '';

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

/**
 * One goal: what is being asked, how far along the city is, and what it pays.
 *
 * The bar carries the reading, not a percentage — "18 / 24 kare yol" says both
 * where the city is and what the next thing to do is, which a percentage does
 * not.
 */
function missionRow(view: MissionView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mission-row';

  const head = document.createElement('div');
  head.className = 'mission-head';
  const name = document.createElement('span');
  name.className = 'mission-name';
  name.textContent = describeGoal(view.goal);
  const reward = document.createElement('span');
  reward.className = 'mission-reward mono';
  reward.textContent = STR.mission.reward(view.reward);
  head.append(name, reward);

  const track = document.createElement('div');
  track.className = 'mission-track';
  const fill = document.createElement('span');
  fill.className = 'mission-fill';
  fill.style.width = `${Math.round(view.fraction * 100)}%`;
  track.append(fill);

  const count = document.createElement('span');
  count.className = 'mission-count mono';
  count.textContent = STR.mission.progress(view.have, view.want);

  el.append(head, track, count);
  return el;
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
