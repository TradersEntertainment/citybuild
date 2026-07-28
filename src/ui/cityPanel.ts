import {
  isTierUnlocked,
  PROGRAMME_ORDER,
  tierAt,
  tiersOf,
  type ProgrammeId,
} from '../data/investments';
import { SERVICE_ORDER, type ServiceKind } from '../data/services';
import { POLICY_ORDER, POLICY_SPECS, type PolicyId } from '../data/policies';
import { STR } from '../data/strings.tr';
import { REPORT_DIMENSIONS } from '../sim/report';
import { PROMISE_LIMIT } from '../data/promises';
import type { Era } from '../sim/tiles';
import { uiStore, type MissionView, type ProgrammeView } from '../state/store';
import { describeGoal } from './missionText';
import * as haptics from './haptics';

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
  /** Buys the next tier of a civic programme; returns whether it went through. */
  onInvest(id: ProgrammeId): void;
  /** Moves a department's funding one notch (sim/budgets.ts). */
  onBudget(kind: ServiceKind, direction: number): void;
  /** Toggles an ordinance; the shell speaks the outcome (sim/policies.ts). */
  onPolicy(id: PolicyId): void;
  /** Says a promise out loud (§30). */
  onPromise(id: string): void;
  /** Whether an ordinance is in force, for the row state. */
  policyActive(id: PolicyId): boolean;
  policyUnlocked(id: PolicyId): boolean;
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
  // Who those people actually are (sim/cohorts.ts). A city cannot be planned
  // around its age structure unless the age structure is on the screen — and the
  // schooled figure is the only visible return on a school for a whole band.
  const ages = row(STR.cohort.title);
  const schooling = row(STR.cohort.schooled(0));
  const burials = row(STR.cohort.backlogRow);
  const bins = row(STR.rubbish.row);
  people.body.append(
    housing.el,
    vacancy.el,
    workers.el,
    unemployment.el,
    ages.el,
    schooling.el,
    burials.el,
    bins.el,
  );

  const books = section(STR.panel.books);
  const tax = row(STR.panel.tax);
  const transit = row(STR.panel.transit);
  const farmIncome = row(STR.panel.farmIncome);
  const sea = row(STR.seaIncome);
  const riders = row(STR.transit.riders);
  const fares = row(STR.transit.fares);
  const visiting = row(STR.visitorIncome);
  const tourism = row(STR.tourismIncome);
  const lobbies = row(STR.lobbyIncome);
  const roads = row(STR.panel.roads);
  const stations = row(STR.panel.stations);
  const plants = row(STR.panel.plants);
  const lines = row(STR.transit.upkeep);
  const programmes = row(STR.invest.upkeep);
  const debt = row(STR.panel.debt);
  const net = row(STR.panel.net, true);
  books.body.append(
    tax.el,
    transit.el,
    visiting.el,
    tourism.el,
    sea.el,
    riders.el,
    fares.el,
    farmIncome.el,
    roads.el,
    stations.el,
    plants.el,
    lines.el,
    programmes.el,
    debt.el,
    net.el,
  );

  // Hidden until the era expects utilities at all, so a village is not shown a
  // shortfall in a system it is not meant to have.
  /**
   * A row per department, with what it is funded at and two buttons.
   *
   * Only the departments the city has actually built: a village shown six
   * sliders for services it has never met is a settings screen, and this is
   * supposed to be a decision about the city in front of it.
   */
  const budgets = section(STR.budget.title);
  budgets.body.append(noteRow(STR.budget.note));
  // The standing approval, above the sliders that move it. A defeat has to be a
  // warning that was ignored rather than a die that came up badly, and that only
  // works if the number is on the screen the whole time.
  const approvalRow = row(STR.election.row);
  const electionRow = row(STR.election.countdown);
  budgets.body.append(approvalRow.el, electionRow.el);
  const budgetRows = new Map<ServiceKind, { el: HTMLElement; set: (text: string) => void }>();
  for (const kind of SERVICE_ORDER) {
    const built = budgetRow(kind);
    budgetRows.set(kind, built);
    budgets.body.append(built.el);
  }

  /** One department: its name, what it is funded at, and two buttons. */
  function budgetRow(kind: ServiceKind): { el: HTMLElement; set: (text: string) => void } {
    const el = document.createElement('div');
    el.className = 'panel-row budget-row';
    const name = document.createElement('span');
    name.textContent = STR.service[kind];
    const value = document.createElement('span');
    value.className = 'panel-value mono';
    const controls = document.createElement('span');
    controls.className = 'budget-controls';
    for (const direction of [-1, 1]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'budget-button';
      button.textContent = direction < 0 ? STR.budget.down : STR.budget.up;
      button.setAttribute('aria-label', `${STR.service[kind]} ${button.textContent}`);
      button.addEventListener('click', () => {
        deps.onBudget(kind, direction);
        haptics.tap();
      });
      controls.append(button);
    }
    el.append(name, value, controls);
    return {
      el,
      set: (text) => {
        if (value.textContent !== text) value.textContent = text;
      },
    };
  }

  const grid = section(STR.panel.gridTitle);
  const water = row(STR.panel.water);
  const power = row(STR.panel.power);
  grid.body.append(water.el, power.el);

  const trade = section(STR.panel.demandTitle);
  const demandRes = row(STR.zone.res);
  const demandCom = row(STR.zone.com);
  const demandInd = row(STR.zone.ind);
  const demandOffice = row(STR.zone.office);
  const farms = row(STR.panel.farmYield);
  trade.body.append(demandRes.el, demandCom.el, demandInd.el, demandOffice.el, farms.el);

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
  /**
   * Where a rich city's money goes (data/investments.ts).
   *
   * Above the retire section and below the books, which is where a player who has
   * just read a large balance is looking. Each programme is one row and one
   * button: a price, what it does, and buy. Nothing is placed and nothing can be
   * put in the wrong spot, so there is no map interaction to explain.
   */
  const invest = section(STR.invest.title);
  const investNote = document.createElement('p');
  investNote.className = 'mission-empty';
  investNote.textContent = STR.invest.note;
  invest.body.append(investNote);
  const programmeRows = new Map<ProgrammeId, ProgrammeRow>();
  for (const id of PROGRAMME_ORDER) {
    const built = programmeRow(id, () => deps.onInvest(id));
    programmeRows.set(id, built);
    invest.body.append(built.el);
  }
  inner.append(invest.el);

  /**
   * The electorate (sim/groups.ts, §23): the factions and how each would
   * vote. It sits directly above the ordinances that swing them, so cause
   * and constituency share a screen — toggle the night shift and watch the
   * industrialists' bar and the pensioners' bar move apart.
   */
  const opinion = section(STR.groups.title);
  const opinionNote = document.createElement('p');
  opinionNote.className = 'mission-empty';
  opinionNote.textContent = STR.groups.note;
  opinion.body.append(opinionNote);
  const groupRows = new Map<
    string,
    { el: HTMLDivElement; share: HTMLSpanElement; value: HTMLSpanElement; bar: HTMLDivElement }
  >();
  const groupList = document.createElement('div');
  opinion.body.append(groupList);
  inner.append(opinion.el);

  /**
   * The signed deals (§24), directly under the electorate they moved.
   *
   * The countdown is the whole reason this section exists. The card that
   * offered the deal is gone within seconds; without a row saying "petrol
   * şirketi, 240 sn kaldı" the player would be living with a consequence whose
   * source they cannot look up and whose end they cannot plan for — and the
   * pollution that lifts when it lapses would read as the sim wandering rather
   * than as their term ending.
   */
  /**
   * The report card (§25), directly above the electorate it is allowed to
   * disagree with.
   *
   * Position is the argument. Approval sits a few rows below with a big number
   * beside it; putting the card anywhere else would let a player read one and
   * never the other, and the entire point is that a mayor on 78% approval with
   * a D in Adalet should have to look at both at once.
   *
   * The note under the heading says so in one line, because a second percentage
   * with no explanation reads as a bug rather than as a different question.
   */
  const report = section(STR.report.title);
  const reportNote = document.createElement('p');
  reportNote.className = 'mission-empty';
  reportNote.textContent = STR.report.note;
  const reportOverall = row(STR.report.overall);
  report.body.append(reportNote, reportOverall.el);

  const reportRows = new Map<string, { value: HTMLSpanElement; bar: HTMLDivElement }>();
  for (const dimension of REPORT_DIMENSIONS) {
    const el = document.createElement('div');
    el.className = 'panel-group';
    const head = document.createElement('div');
    head.className = 'panel-row';
    const name = document.createElement('span');
    name.textContent = STR.report.names[dimension];
    const value = document.createElement('span');
    value.className = 'panel-value mono';
    head.append(name, value);
    const track = document.createElement('div');
    track.className = 'panel-group-track';
    const bar = document.createElement('div');
    bar.className = 'panel-group-bar';
    track.append(bar);
    el.append(head, track);
    report.body.append(el);
    reportRows.set(dimension, { value, bar });
  }
  inner.append(report.el);

  /**
   * Legitimacy (§29), directly above the deals and the electorate.
   *
   * Shown only once it means something. A mayor who has never lost a vote has
   * never been asked the question, and a row reading "Seçilmiş yönetim · %0"
   * would be the game teasing a mechanic they have not met — the same reason
   * the electorate section stays hidden in an empty city.
   *
   * The hint line is the part that matters. A meter with no stated way down is
   * a punishment; this one always says what settles it, and for a government
   * that ended the voting it says the only thing that can.
   */
  /**
   * Campaign promises (§30), directly above the legitimacy the mayor is
   * spending them on.
   *
   * The note under the heading states the whole mechanic in one line —
   * free now, expensive later — because a player who discovers the second half
   * at an election they lost would rightly feel tricked. Populism is supposed
   * to be tempting, not hidden.
   */
  /**
   * Who is standing against the mayor (§31), directly above the promises that
   * are the answer to them.
   *
   * That adjacency is the argument. A player who reads "Nuri Balaban —
   * sürücülere ve esnafa oynuyor" and then sees the promise list immediately
   * underneath has been handed both the problem and the verb without a word of
   * tutorial.
   */
  const rival = section(STR.opponent.heading);
  const rivalNote = document.createElement('p');
  rivalNote.className = 'mission-empty';
  rivalNote.textContent = STR.opponent.note;
  const rivalRow = row(STR.opponent.heading);
  const rivalTaking = row(STR.opponent.taking);
  rival.body.append(rivalNote, rivalRow.el, rivalTaking.el);
  inner.append(rival.el);

  const promises = section(STR.promise.title);
  const promiseNote = document.createElement('p');
  promiseNote.className = 'mission-empty';
  promiseNote.textContent = STR.promise.note;
  const promiseCount = row(STR.promise.title);
  const promiseList = document.createElement('div');
  const betrayedRow = row(STR.promise.betrayed);
  promises.body.append(promiseNote, promiseCount.el, promiseList, betrayedRow.el);
  inner.append(promises.el);

  const promiseRows = new Map<
    string,
    { button: HTMLButtonElement; value: HTMLSpanElement }
  >();
  /** A promise's row: what it says, who it is aimed at, and where the city is. */
  const promiseRow = (id: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-policy';

    const name = document.createElement('span');
    const key = id as keyof typeof STR.promise.names;
    name.textContent = `${STR.promise.names[key]} — ${STR.promise.courts[key]}`;
    const value = document.createElement('span');
    value.className = 'panel-value mono';
    button.append(name, value);
    button.addEventListener('click', () => deps.onPromise(id));
    promiseList.append(button);

    const made = { button, value };
    promiseRows.set(id, made);
    return made;
  };

  const legitimacy = section(STR.crisis.heading);
  const mandateRow = row(STR.crisis.mandate.elected);
  const unrestRow = row(STR.crisis.unrest);
  const legitimacyHint = document.createElement('p');
  legitimacyHint.className = 'mission-empty';
  const unrestTrack = document.createElement('div');
  unrestTrack.className = 'panel-group-track';
  const unrestBar = document.createElement('div');
  unrestBar.className = 'panel-group-bar';
  unrestTrack.append(unrestBar);
  legitimacy.body.append(mandateRow.el, unrestRow.el, unrestTrack, legitimacyHint);
  inner.append(legitimacy.el);

  const deals = section(STR.lobby.heading);
  const dealsEmpty = document.createElement('p');
  dealsEmpty.className = 'mission-empty';
  dealsEmpty.textContent = STR.lobby.none;
  const dealList = document.createElement('div');
  deals.body.append(dealsEmpty, dealList);
  inner.append(deals.el);

  const dealRows = new Map<string, { el: HTMLDivElement; value: HTMLSpanElement }>();
  /** Built on first sight and reused, exactly like a faction's row. */
  const dealRow = (id: string) => {
    const el = document.createElement('div');
    el.className = 'panel-row';
    const name = document.createElement('span');
    name.textContent = STR.lobby.names[id as keyof typeof STR.lobby.names] ?? id;
    const value = document.createElement('span');
    value.className = 'panel-value mono';
    el.append(name, value);
    const row = { el, value };
    dealRows.set(id, row);
    dealList.append(el);
    return row;
  };

  /** A faction's row is built on first sight and reused; only text and width move. */
  const groupRow = (id: string) => {
    const el = document.createElement('div');
    el.className = 'panel-group';
    const head = document.createElement('div');
    head.className = 'panel-row';
    const name = document.createElement('span');
    name.textContent = STR.groups.name[id] ?? id;
    const share = document.createElement('span');
    share.className = 'panel-group-share mono';
    const value = document.createElement('span');
    value.className = 'panel-value mono';
    head.append(name, share, value);
    const track = document.createElement('div');
    track.className = 'panel-group-track';
    const bar = document.createElement('div');
    bar.className = 'panel-group-bar';
    track.append(bar);
    el.append(head, track);
    const row = { el, share, value, bar };
    groupRows.set(id, row);
    groupList.append(el);
    return row;
  };

  /**
   * The ordinances (sim/policies.ts): the levers a council pulls without
   * building anything. Each row is the toggle itself — a separate button per
   * row would double the section to say the same thing — and every row shows
   * both sides of its trade, because a policy with no visible cost would be a
   * checkbox rather than a decision.
   */
  const policies = section(STR.policy.title);
  const policyNote = document.createElement('p');
  policyNote.className = 'mission-empty';
  policyNote.textContent = STR.policy.note;
  policies.body.append(policyNote);
  const policyRows = new Map<PolicyId, HTMLButtonElement>();
  for (const id of POLICY_ORDER) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-policy';
    const head = document.createElement('div');
    head.className = 'panel-row';
    const name = document.createElement('span');
    name.textContent = STR.policy.name[id];
    const stateTag = document.createElement('span');
    stateTag.className = 'panel-value mono';
    head.append(name, stateTag);
    const detail = document.createElement('p');
    detail.className = 'mission-empty';
    detail.textContent = STR.policy.detail[id];
    button.append(head, detail);
    button.addEventListener('click', () => deps.onPolicy(id));
    policyRows.set(id, button);
    policies.body.append(button);
  }
  inner.append(policies.el);

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
    for (const [id, built] of programmeRows) built.paint(s.investments[id], s.money, s.era);
    const jobs = t.commercialJobs + t.industrialJobs + t.farmJobs;
    // From the bands, not from a flat constant. The sim stopped assuming half of
    // everyone works; a panel that carried on assuming it would have reported a
    // workforce a city of children does not have.
    const d = s.demography;
    const workforce = s.population * d.working;
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
    approvalRow.set(STR.format.percent(s.approval));
    approvalRow.el.dataset['alarm'] = String(s.approval < 0.5 && s.population > 0);
    // And when it will be counted. An approval figure with no date attached is a
    // number; with a date it is a deadline, which is the whole point of holding
    // the vote on the calendar rather than continuously.
    electionRow.el.hidden = s.population <= 0;
    electionRow.set(STR.election.next(s.secondsToElection));
    // Only the departments the city has actually built. Six sliders for services
    // a village has never met is a settings screen, not a decision.
    for (const [kind, built] of budgetRows) {
      const has = (s.stations[kind] ?? 0) > 0;
      built.el.hidden = !has;
      if (has) built.set(STR.budget.level(s.budgets[kind] ?? 1));
    }
    // The age structure, as four counts on one line: children, young, adult, old.
    // Four rows would bury the section; one reads as a shape.
    ages.set(STR.cohort.spread(d.child, d.young, d.adult, d.elder));
    // Hidden until a school has produced somebody, so a village is not shown a
    // permanent zero about a system it has not met.
    schooling.el.hidden = d.schooled <= 0;
    schooling.set(STR.format.percent(d.schooled));
    // Likewise: only once there is a backlog worth minding.
    burials.el.hidden = d.awaitingBurial < 1;
    burials.set(count(d.awaitingBurial));
    burials.el.dataset['alarm'] = String(d.awaitingBurial > Math.max(4, s.population / 250));
    // Hidden until there is anything in the bins, so a founding settlement is not
    // shown a row about a service it has not met.
    bins.el.hidden = s.rubbish.waiting < 1;
    bins.set(count(s.rubbish.waiting));
    bins.el.dataset['alarm'] = String(s.rubbish.strain > 0);

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
    // Hidden until a programme is running, like every other conditional row.
    programmes.el.hidden = s.ledger.programmeUpkeep <= 0;
    programmes.set(`−${money(s.ledger.programmeUpkeep)}`);
    // Both hidden until the city runs a line, like every other row about a
    // system it has not met.
    // The ridership beside the fares it earned: without it a player who lays a
    // line has a bill and no way to tell whether anybody is on the bus.
    riders.el.hidden = s.riders <= 0;
    riders.set(count(s.riders));
    fares.el.hidden = s.ledger.fareIncome <= 0;
    fares.set(`+${money(s.ledger.fareIncome)}`);
    // Hidden until the first hotel bills a guest, like the fares: a zero row
    // for a system the player has not touched is furniture.
    tourism.el.hidden = s.ledger.tourismIncome <= 0;
    tourism.set(`+${money(s.ledger.tourismIncome)}`);
    // The one row that can go either way, so it carries its own sign rather
    // than a fixed one. Hidden only when nothing is signed — a deal costing the
    // city money is exactly the case the player must be able to see.
    lobbies.el.hidden = s.ledger.lobbyIncome === 0;
    lobbies.set(
      s.ledger.lobbyIncome >= 0
        ? `+${money(s.ledger.lobbyIncome)}`
        : `−${money(-s.ledger.lobbyIncome)}`,
    );
    // The factions, weight and verdict each (§23). Hidden until anybody lives
    // here — an opinion section about nobody is furniture. Rows with no real
    // constituency (a village with no industry has no industrialists) stay
    // hidden too, the same rule as the budget sliders.
    opinion.el.hidden = s.population <= 0;
    for (const view of s.groups) {
      const row = groupRows.get(view.id) ?? groupRow(view.id);
      const present = view.weight >= 0.005;
      row.el.hidden = !present;
      if (!present) continue;
      row.share.textContent = STR.groups.share(view.weight);
      row.value.textContent = STR.format.percent(view.approval);
      row.el.dataset['alarm'] = String(view.approval < 0.4);
      row.bar.style.width = `${Math.round(view.approval * 100)}%`;
    }
    // The card, graded. Hidden until anybody lives here, the same rule the
    // electorate keeps: a report on a city that has not started is the game
    // marking a player down for not having built anything yet.
    report.el.hidden = s.population <= 0;
    reportOverall.set(`${s.report.grade} · ${STR.format.percent(s.report.overall)}`);
    for (const [id, row_] of reportRows) {
      const score = s.report.scores[id] ?? 0;
      row_.value.textContent = STR.format.percent(score);
      row_.bar.style.width = `${Math.round(score * 100)}%`;
    }
    // The candidate, and what they are currently taking. Hidden when nobody is
    // standing — a village before its first vote, or a city whose government
    // ended the voting altogether (§29). Saying "Rakip: yok" in the second case
    // would be technically true and deeply misleading.
    rival.el.hidden = s.opponent === null;
    if (s.opponent) {
      const groups = s.opponent.courts.map(
        (id) => STR.groups.name[id] ?? id,
      );
      rivalRow.set(
        STR.opponent.platform(s.opponent.name, groups[0] ?? '', groups[1] ?? ''),
      );
      // Shown even at zero, and that zero is information: it means the player
      // has looked after both constituencies well enough that there is nothing
      // to take. Hiding it would remove the feedback for having done the work.
      rivalTaking.set(STR.format.percent(s.opponent.lost));
      rivalTaking.el.dataset['alarm'] = String(s.opponent.lost >= 0.08);
    }

    // The promises. Shown from the era that opens the first one, because unlike
    // legitimacy this is a verb the player is meant to reach for rather than a
    // consequence they stumble into.
    let made = 0;
    let anyUnlocked = false;
    for (const view of s.promises) {
      const promiseView = promiseRows.get(view.id) ?? promiseRow(view.id);
      promiseView.button.hidden = !view.unlocked;
      if (!view.unlocked) continue;
      anyUnlocked = true;
      if (view.made) made++;
      promiseView.button.dataset['selected'] = String(view.made);
      // Where the city stands against the bar, and whether that clears it. Shown
      // for every promise, made or not: a player deciding what to promise wants
      // to know which ones they are already close to.
      const clears = view.progress >= view.target;
      promiseView.value.textContent = view.made
        ? `${STR.format.percent(view.progress)} · ${clears ? STR.promise.onTrack : STR.promise.behind}`
        : STR.promise.progress(
            STR.format.percent(view.progress),
            STR.format.percent(view.target),
          );
      promiseView.button.dataset['alarm'] = String(view.made && !clears);
    }
    promises.el.hidden = !anyUnlocked;
    promiseCount.set(STR.promise.count(made, PROMISE_LIMIT));
    // The grudge is its own row and hidden until there is one — a "0" here
    // would be the game reminding a player of a mistake they have not made.
    betrayedRow.el.hidden = s.betrayed <= 0.005;
    betrayedRow.set(STR.format.percent(Math.min(1, s.betrayed)));
    betrayedRow.el.dataset['alarm'] = 'true';

    // Legitimacy, hidden until the player has actually been asked the question.
    const mandate = s.mandate as keyof typeof STR.crisis.mandate;
    const contested = mandate !== 'elected' || s.unrest > 0.005;
    legitimacy.el.hidden = !contested;
    mandateRow.el.hidden = false;
    mandateRow.set(STR.crisis.mandate[mandate] ?? mandate);
    unrestRow.set(STR.format.percent(s.unrest));
    unrestRow.el.dataset['alarm'] = String(s.unrest >= 0.5);
    unrestBar.style.width = `${Math.round(s.unrest * 100)}%`;
    legitimacyHint.textContent = STR.crisis.hint[mandate] ?? '';
    // The deals in force, with what is left of each. The section stays visible
    // with none signed and says so: "imzalı anlaşma yok" is information — a
    // player who has forgotten whether they took the oil money can check —
    // whereas a section that vanished would leave them nowhere to look.
    for (const row of dealRows.values()) row.el.hidden = true;
    for (const view of s.lobbies) {
      const row = dealRows.get(view.id) ?? dealRow(view.id);
      row.el.hidden = false;
      row.value.textContent = STR.lobby.remaining(view.remaining);
    }
    dealsEmpty.hidden = s.lobbies.length > 0;
    // The ordinance rows carry their own state: in force, available, or what
    // era opens them — a lock always shows what opens it (§1).
    for (const [id, button] of policyRows) {
      const unlocked = deps.policyUnlocked(id);
      const active = deps.policyActive(id);
      button.dataset['selected'] = String(active);
      button.dataset['locked'] = String(!unlocked);
      const tag = button.querySelector('.panel-value');
      if (tag) {
        tag.textContent = !unlocked
          ? STR.lockedAt(STR.eraName[POLICY_SPECS[id].unlockedAt])
          : active
            ? STR.policy.on
            : STR.policy.off;
      }
    }
    lines.el.hidden = s.ledger.transitUpkeep <= 0;
    lines.set(`−${money(s.ledger.transitUpkeep)}`);
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
    demandOffice.set(STR.format.percent(s.demand.office));
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
  // A mandate pays in what outlives the city, so it must not be shown as "+₺0"
  // — a reward line quoting nothing would read as a goal that pays nothing.
  reward.textContent =
    view.legacy > 0 ? STR.mission.rewardLegacy(view.legacy) : STR.mission.reward(view.reward);
  // …and a site goal names the square it is pointing at, so the panel and the
  // outline on the ground are recognisably about the same place.
  if (view.site) {
    const where = document.createElement('span');
    where.className = 'panel-group-share mono';
    where.textContent = STR.mission.site(view.site);
    head.append(where);
  }
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

interface ProgrammeRow {
  el: HTMLElement;
  paint(view: ProgrammeView, money: number, era: Era): void;
}

/**
 * One programme: what it is, what the next tier costs, and a button.
 *
 * The button says the price rather than "buy", because the price is the decision
 * — and it is disabled with the reason showing rather than hidden, so a player
 * who cannot afford a tier can see what they are saving for.
 */
function programmeRow(id: ProgrammeId, onBuy: () => void): ProgrammeRow {
  const el = document.createElement('div');
  el.className = 'panel-programme';

  const head = document.createElement('div');
  head.className = 'panel-row';
  const name = document.createElement('span');
  name.textContent = STR.invest.name[id];
  const level = document.createElement('span');
  level.className = 'panel-value mono';
  head.append(name, level);

  const detail = document.createElement('p');
  detail.className = 'mission-empty';
  detail.textContent = STR.invest.detail[id];

  const buy = document.createElement('button');
  buy.type = 'button';
  buy.className = 'panel-action';
  buy.addEventListener('click', onBuy);

  el.append(head, detail, buy);

  return {
    el,
    paint: (view, money, era) => {
      const tiers = tiersOf(id);
      level.textContent = STR.invest.level(view.level, tiers.length);
      const next = tierAt(id, view.level);
      if (!next) {
        buy.hidden = true;
        detail.textContent = STR.invest.complete;
        return;
      }
      buy.hidden = false;
      detail.textContent = STR.invest.detail[id];
      const unlocked = isTierUnlocked(id, view.level, era);
      buy.disabled = !unlocked || money < next.cost;
      buy.textContent = unlocked
        ? STR.invest.buy(next.name, next.cost, next.upkeep)
        : STR.lockedAt(STR.eraName[next.unlockedAt]);
    },
  };
}

/** A line of explanation inside a section, styled like the sheet's notes. */
function noteRow(text: string): HTMLElement {
  const el = document.createElement('p');
  el.className = 'panel-note';
  el.textContent = text;
  return el;
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
