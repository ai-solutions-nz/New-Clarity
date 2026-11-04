/**
 * AI Solutions NZ - cold outreach from Google Sheets + Gmail.
 *
 * Bound to a Google Sheet. Adds an "Outreach" menu. Sends only rows a human has
 * approved (plus due follow-ups of rows already contacted), with a daily cap,
 * a send window, opt-out handling and a full log.
 *
 * Safety defaults: Dry run is ON until you switch it off in the Settings tab.
 * No credentials are used or stored. Gmail access is the signed-in user's own.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NZ_TZ = 'Pacific/Auckland';
const TAB = { TEMPLATES: 'Templates', SETTINGS: 'Settings', LOG: 'Log', PREVIEW: 'Preview' };
const RESERVED_TABS = [TAB.TEMPLATES, TAB.SETTINGS, TAB.LOG, TAB.PREVIEW];

const ST = {
  NEW: 'New', APPROVED: 'Approved', EMAILED: 'Emailed', FOLLOWED: 'Followed up',
  REPLIED: 'Replied', WON: 'Won', UNSUB: 'Unsubscribed', BOUNCED: 'Bounced'
};
const STATUS_LIST = [ST.NEW, ST.APPROVED, ST.EMAILED, ST.FOLLOWED, ST.REPLIED, ST.WON, ST.UNSUB, ST.BOUNCED];
const CONTACTED = [ST.EMAILED, ST.FOLLOWED];

// Step = number of follow-ups already sent (0 = only the first email sent).
// Gap in days until the next email, indexed by the NEW step after a send.
// First email day 0, follow-ups day 3, day 7, day 14.
const FOLLOWUP_GAPS = { 0: 3, 1: 4, 2: 7 };
const MAX_STEP = 3;

const MAX_DAILY_CAP = 20;          // hard ceiling, raise only if you really mean to
const DEFAULT_DAILY_CAP = 10;
const TEST_MODE_MAX = 3;           // max emails per run while a test recipient is set
const MIN_GAP_MS = 30000;
const MAX_GAP_MS = 90000;
const RUN_LIMIT_MS = 360000;       // Apps Script hard limit is 6 minutes
const RUN_MARGIN_MS = 40000;

const GENERIC_LOCALS = ['info', 'admin', 'hello', 'office', 'enquiries', 'enquiry', 'contact',
  'sales', 'support', 'reception', 'mail', 'team', 'accounts', 'bookings', 'service', 'general'];

// key, canonical header, accepted alternative headers (matched ignoring case/punctuation)
const LEAD_COLUMNS = [
  { key: 'business', header: 'Business name', aliases: ['business', 'name', 'company', 'companyname'] },
  { key: 'city', header: 'City', aliases: ['town', 'suburb'] },
  { key: 'country', header: 'Country', aliases: [] },
  { key: 'website', header: 'Website', aliases: ['url', 'site'] },
  { key: 'email', header: 'Email', aliases: ['emailaddress', 'e-mail'] },
  { key: 'emailType', header: 'Email type', aliases: ['emailkind'] },
  { key: 'facebook', header: 'Facebook URL', aliases: ['facebook'] },
  { key: 'instagram', header: 'Instagram URL', aliases: ['instagram'] },
  { key: 'rating', header: 'Rating', aliases: [] },
  { key: 'reviews', header: 'Reviews', aliases: ['reviewcount'] },
  { key: 'status', header: 'Status', aliases: [] },
  { key: 'nextFollowUp', header: 'Next follow-up date', aliases: ['nextfollowup', 'followupdate'] },
  { key: 'step', header: 'Step', aliases: [] },
  { key: 'lastSent', header: 'Last sent', aliases: [] },
  { key: 'threadId', header: 'Thread ID', aliases: ['threadid'] },
  { key: 'notes', header: 'Notes', aliases: [] },
  // Extras added by Setup (optional for you to fill in)
  { key: 'allowGeneric', header: 'Allow generic', aliases: [] },
  { key: 'firstName', header: 'First name', aliases: ['firstname', 'contactname'] }
];
const REQUIRED_KEYS = ['business', 'email', 'status', 'step', 'lastSent', 'threadId', 'nextFollowUp'];

const SETTINGS_DEFAULTS = [
  ['Dry run', true, 'ON = nothing is sent, actions are only logged. Untick to go live.'],
  ['Daily send cap', DEFAULT_DAILY_CAP, 'Start at 10, ramp up to ' + MAX_DAILY_CAP + ' over a few weeks.'],
  ['Send window start', '08:30', 'Pacific/Auckland time, weekdays only.'],
  ['Send window end', '16:00', 'Pacific/Auckland time. Nothing is sent after this.'],
  ['Sender name', 'Nela Muttettuwegama', 'Used as the From name and in {{sender}}.'],
  ['Sender business name', 'AI Solutions NZ', 'Shown in every email footer.'],
  ['Business address', '[Add your NZ postal address here]', 'Shown in every footer. Live sending is blocked while this still has square brackets.'],
  ['ABN (Australia)', '[Add your ABN here]', 'Added to the footer of emails to Australian leads. Live sending to AU is blocked while this has square brackets.'],
  ['Unsubscribe text', "Reply STOP and I won't email you again.", 'One-line opt-out added to every email.'],
  ['Sender alias email', '', 'Optional. A Gmail "Send mail as" alias to send from. Leave blank to use your main address.'],
  ['Test recipient', '', 'LIVE TEST: if set (and Dry run is off), every email goes to this address only, no lead is touched.']
];

const LOG_HEADERS = ['Timestamp', 'Mode', 'Tab', 'Row', 'Email', 'Subject', 'Step', 'Detail'];
const PREVIEW_HEADERS = ['Tab', 'Row', 'To', 'From', 'Type', 'Subject', 'Email as it will be sent', 'Verdict'];
const TEMPLATE_HEADERS = ['Segment', 'Step', 'Subject', 'Body'];

const DEFAULT_TEMPLATES = [
  {
    segment: 'Property managers', step: 1,
    subject: 'Missed enquiries at {{business}}',
    body: 'Hi {{first_name}},\n\n' +
      'When a tenant or owner rings a property manager and nobody picks up, they often try the next agency on the list. Missed calls and slow replies to rental enquiries are the usual leaks.\n\n' +
      'I run AI Solutions NZ in Christchurch. We set up missed-call text-back and instant enquiry replies for small {{city}} property teams, usually within a few days.\n\n' +
      'Open to a 10 minute chat, or just reply if you would like details?\n\n{{sender}}'
  },
  {
    segment: 'Property managers', step: 2, subject: '(same thread)',
    body: 'Hi {{first_name}},\n\n' +
      'Following up on my note about missed calls and slow enquiry replies at {{business}}.\n\n' +
      'A simple fix is an automatic text when a call is missed, plus an instant reply to web enquiries that asks which property and a good time to talk. Your team stops chasing.\n\n' +
      'Happy to show you how it works in 10 minutes if that is useful.\n\n{{sender}}'
  },
  {
    segment: 'Property managers', step: 3, subject: '(same thread)',
    body: 'Hi {{first_name}},\n\n' +
      'One more idea for {{business}}. We also set up automatic reminders for inspections and appointments, and polite review requests once a job is wrapped up, so owners and tenants hear from you without anyone typing it out each time.\n\n' +
      'If that would help, reply with a time that suits for a quick 10 minute chat.\n\n{{sender}}'
  },
  {
    segment: 'Property managers', step: 4, subject: '(same thread)',
    body: 'Hi {{first_name}},\n\n' +
      'I will leave it here so I do not clutter your inbox. If missed calls or slow replies to enquiries ever become a headache at {{business}}, reply any time and I will send a short outline of what we would set up.\n\n' +
      'All the best,\n{{sender}}'
  },
  {
    segment: 'Cleaning', step: 1,
    subject: 'Quote requests at {{business}}',
    body: 'Hi {{first_name}},\n\n' +
      'Most people ask two or three cleaning companies for a quote and go with whoever replies first. If you are out on a job, a missed call or a slow quote reply can mean a lost booking.\n\n' +
      'I run AI Solutions NZ in Christchurch. We set up missed-call text-back, instant enquiry replies and quote follow-up for small cleaning businesses, usually within days.\n\n' +
      'Open to a 10 minute chat, or reply if you would like details?\n\n{{sender}}'
  },
  {
    segment: 'Cleaning', step: 2, subject: '(same thread)',
    body: 'Hi {{first_name}},\n\n' +
      'Quick follow-up on my last note. For a cleaning business like {{business}}, the biggest win is usually a text that goes out straight away when a call is missed, then a gentle nudge a couple of days after a quote is sent.\n\n' +
      'Would 10 minutes this week suit, to see how it works?\n\n{{sender}}'
  },
  {
    segment: 'Cleaning', step: 3, subject: '(same thread)',
    body: 'Hi {{first_name}},\n\n' +
      'We also set up booking reminders, which cut down no-shows and last minute cancellations, and a simple review request after each clean so happy customers leave a Google review without you chasing.\n\n' +
      'Reply if you would like a quick walkthrough.\n\n{{sender}}'
  },
  {
    segment: 'Cleaning', step: 4, subject: '(same thread)',
    body: 'Hi {{first_name}},\n\n' +
      'I will not keep emailing after this one. If slow quote replies or missed calls ever start costing {{business}} work, reply any time and I will send a short outline of what we would set up.\n\n' +
      'All the best,\n{{sender}}'
  }
];

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Outreach')
    .addItem('Setup', 'setupOutreach')
    .addSeparator()
    .addItem('Approve selected rows', 'approveSelectedRows')
    .addItem('Preview next batch', 'previewNextBatch')
    .addItem('Send now (up to cap)', 'sendNow')
    .addItem('Check replies', 'checkRepliesMenu')
    .addSeparator()
    .addItem('Install daily triggers', 'installDailyTriggers')
    .addItem('Remove triggers', 'removeTriggers')
    .addItem('Run self-test (sends nothing)', 'runDryRunTest')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function ui_() {
  try { return SpreadsheetApp.getUi(); } catch (e) { return null; }
}

function alert_(msg, title) {
  const u = ui_();
  if (u) u.alert(title || 'Outreach', msg, u.ButtonSet.OK);
  else Logger.log((title || 'Outreach') + ': ' + msg);
}

function confirm_(msg, title) {
  const u = ui_();
  if (!u) return false;
  return u.alert(title || 'Outreach', msg, u.ButtonSet.YES_NO) === u.Button.YES;
}

function norm_(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function nzDate_(d) { return Utilities.formatDate(d, NZ_TZ, 'yyyy-MM-dd'); }
function nzDateTime_(d) { return Utilities.formatDate(d, NZ_TZ, 'yyyy-MM-dd HH:mm:ss'); }

function addDays_(dateStr, n) {
  const p = dateStr.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

/** Accepts a Date, 'yyyy-MM-dd...' or 'd/M/yyyy' and returns 'yyyy-MM-dd' or ''. */
function toDateStr_(v) {
  if (v instanceof Date) return nzDate_(v);
  const s = str_(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return '';
}

function parseTime_(v, fallback) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'HH:mm');
  const m = /(\d{1,2}):(\d{2})/.exec(str_(v));
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : fallback;
}

function isTrue_(v) {
  return v === true || /^(true|yes|y|on|1|x)$/i.test(str_(v));
}

function validEmail_(e) {
  return /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/.test(e);
}

function normCountry_(c) {
  const s = str_(c).toLowerCase();
  if (['nz', 'nzl', 'new zealand', 'aotearoa'].indexOf(s) >= 0) return 'NZ';
  if (['au', 'aus', 'australia'].indexOf(s) >= 0) return 'AU';
  return '';
}

function isGenericEmail_(lead) {
  const local = str_(lead.email).toLowerCase().split('@')[0];
  return norm_(lead.emailType) === 'generic' || GENERIC_LOCALS.indexOf(local) >= 0;
}

function normStatus_(s) {
  const t = norm_(s);
  if (!t) return ST.NEW;
  for (let i = 0; i < STATUS_LIST.length; i++) if (norm_(STATUS_LIST[i]) === t) return STATUS_LIST[i];
  return str_(s); // unknown status, will be ignored by everything
}

// ---------------------------------------------------------------------------
// Sheet access
// ---------------------------------------------------------------------------

function headerMap_(headerRow) {
  const map = {};
  const normHeaders = headerRow.map(norm_);
  LEAD_COLUMNS.forEach(function (col) {
    const names = [norm_(col.header)].concat(col.aliases.map(norm_));
    for (let i = 0; i < normHeaders.length; i++) {
      if (normHeaders[i] && names.indexOf(normHeaders[i]) >= 0) { map[col.key] = i; break; }
    }
  });
  return map;
}

function isLeadSheet_(sh) {
  if (RESERVED_TABS.indexOf(sh.getName()) >= 0) return false;
  if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) return false;
  const map = headerMap_(sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]);
  return REQUIRED_KEYS.every(function (k) { return map[k] !== undefined; });
}

function leadSheets_() {
  return SpreadsheetApp.getActive().getSheets().filter(isLeadSheet_);
}

function readLeads_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const map = headerMap_(values[0]);
  const leads = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const get = function (k) { return map[k] === undefined ? '' : row[map[k]]; };
    const lead = {
      sheet: sh.getName(), row: r + 1, map: map,
      business: str_(get('business')), city: str_(get('city')), country: str_(get('country')),
      website: str_(get('website')), email: str_(get('email')).toLowerCase(),
      emailType: str_(get('emailType')), status: normStatus_(get('status')),
      nextFollowUp: toDateStr_(get('nextFollowUp')),
      step: parseInt(get('step'), 10) || 0,
      lastSent: str_(get('lastSent')), threadId: str_(get('threadId')),
      notes: str_(get('notes')), allowGeneric: isTrue_(get('allowGeneric')),
      firstName: str_(get('firstName'))
    };
    if (!lead.business && !lead.email) continue;
    leads.push(lead);
  }
  return leads;
}

function readAllLeads_() {
  let all = [];
  leadSheets_().forEach(function (sh) { all = all.concat(readLeads_(sh)); });
  return all;
}

function writeLead_(lead, updates) {
  const sh = SpreadsheetApp.getActive().getSheetByName(lead.sheet);
  Object.keys(updates).forEach(function (key) {
    const idx = lead.map[key];
    if (idx === undefined) throw new Error('Column for "' + key + '" not found on tab ' + lead.sheet + '. Run Outreach > Setup.');
    const cell = sh.getRange(lead.row, idx + 1);
    if (key === 'nextFollowUp' || key === 'lastSent') cell.setNumberFormat('@');
    cell.setValue(updates[key]);
  });
}

function appendNote_(lead, text) {
  if (lead.map.notes === undefined) return;
  const sh = SpreadsheetApp.getActive().getSheetByName(lead.sheet);
  const cell = sh.getRange(lead.row, lead.map.notes + 1);
  const old = str_(cell.getValue());
  cell.setValue((old ? old + ' | ' : '') + text);
}

function readTemplates_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.TEMPLATES);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const h = v[0].map(norm_);
  const ci = function (n) { return h.indexOf(n); };
  const out = [];
  for (let r = 1; r < v.length; r++) {
    const seg = str_(v[r][ci('segment')]);
    const step = parseInt(v[r][ci('step')], 10);
    if (!seg || !step) continue;
    out.push({ segment: seg, step: step, subject: str_(v[r][ci('subject')]), body: String(v[r][ci('body')] || '') });
  }
  return out;
}

function findTemplate_(templates, segment, step) {
  const want = norm_(segment);
  let fallback = null;
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    if (t.step !== step) continue;
    if (norm_(t.segment) === want) return t;
    if (['default', 'all', 'any'].indexOf(norm_(t.segment)) >= 0) fallback = t;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function getSettings_() {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.SETTINGS);
  const raw = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (str_(r[0])) raw[str_(r[0]).toLowerCase()] = r[1];
    });
  }
  return parseSettings_(raw);
}

/** Pure: turns raw {lowercased label: value} into typed settings. Dry run is ON unless clearly off. */
function parseSettings_(raw) {
  const g = function (k) { const v = raw[k.toLowerCase()]; return v === undefined || v === null ? '' : v; };
  const dryRaw = g('Dry run');
  const dryOff = dryRaw === false || /^(false|no|off|0)$/i.test(str_(dryRaw));
  let cap = parseInt(g('Daily send cap'), 10);
  if (!cap || cap < 1) cap = DEFAULT_DAILY_CAP;
  cap = Math.min(cap, MAX_DAILY_CAP);
  return {
    dryRun: !dryOff,
    cap: cap,
    windowStart: parseTime_(g('Send window start'), '08:30'),
    windowEnd: parseTime_(g('Send window end'), '16:00'),
    senderName: str_(g('Sender name')),
    businessName: str_(g('Sender business name')),
    address: str_(g('Business address')),
    abn: str_(g('ABN (Australia)')),
    unsubText: str_(g('Unsubscribe text')),
    alias: str_(g('Sender alias email')),
    testRecipient: str_(g('Test recipient')).toLowerCase()
  };
}

function inSendWindow_(date, start, end) {
  const day = parseInt(Utilities.formatDate(date, NZ_TZ, 'u'), 10); // 1 = Monday
  if (day > 5) return false;
  const t = Utilities.formatDate(date, NZ_TZ, 'HH:mm');
  return t >= start && t < end;
}

// ---------------------------------------------------------------------------
// Eligibility, rendering (pure, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Decides what (if anything) should happen to a lead.
 * Returns {action: 'send'|'skip'|'ignore', kind: 'first'|'followup', templateStep, reason}.
 * 'ignore' = not relevant right now (New, Replied, not due...). 'skip' = should have been
 * sent but is blocked, and the reason is shown in Preview.
 */
function evaluateLead_(lead, ctx) {
  const ignore = function (r) { return { action: 'ignore', reason: r }; };
  const skip = function (r) { return { action: 'skip', reason: r }; };
  let kind, templateStep;

  if ([ST.UNSUB, ST.BOUNCED, ST.REPLIED, ST.WON].indexOf(lead.status) >= 0) return ignore('Status ' + lead.status);

  if (lead.status === ST.APPROVED) {
    if (lead.step > 0 || lead.threadId || lead.lastSent) {
      return skip('Approved but already contacted (Step, Last sent or Thread ID is filled). Set Status to Emailed/Followed up, or clear those cells to restart.');
    }
    kind = 'first'; templateStep = 1;
  } else if (CONTACTED.indexOf(lead.status) >= 0) {
    if (lead.step >= MAX_STEP) return ignore('Sequence complete');
    if (!lead.nextFollowUp) return ignore('No follow-up date');
    if (lead.nextFollowUp > ctx.today) return ignore('Follow-up not due until ' + lead.nextFollowUp);
    kind = 'followup'; templateStep = lead.step + 2;
  } else {
    return ignore('Not approved');
  }

  if (!lead.email) return skip('No email address');
  if (!validEmail_(lead.email)) return skip('Email address looks invalid: ' + lead.email);
  if (!lead.business) return skip('No business name');
  const country = normCountry_(lead.country);
  if (!country) return skip('Country must be New Zealand or Australia (got "' + lead.country + '")');
  if (country === 'AU' && isGenericEmail_(lead) && !lead.allowGeneric) {
    return skip('Australia + generic email (' + lead.email + '). Tick "Allow generic" to override.');
  }
  return { action: 'send', kind: kind, templateStep: templateStep, reason: '' };
}

function deriveFirstName_(lead) {
  if (lead.firstName) return lead.firstName;
  if (norm_(lead.emailType) === 'named' && !isGenericEmail_(lead)) {
    const local = lead.email.split('@')[0];
    if (/[._-]/.test(local)) {
      const first = local.split(/[._-]/)[0];
      if (/^[a-z]{2,}$/i.test(first)) return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
    }
  }
  return 'there';
}

function mergeVars_(lead, settings) {
  return { business: lead.business, city: lead.city, first_name: deriveFirstName_(lead), sender: settings.senderName };
}

/** Throws if a field used by the template has no value or the field name is unknown. */
function renderTemplate_(text, vars) {
  return String(text).replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, function (m, name) {
    const k = name.toLowerCase();
    if (!(k in vars)) throw new Error('Unknown merge field ' + m);
    if (!vars[k]) throw new Error('Merge field ' + m + ' is empty for this lead');
    return vars[k];
  });
}

function buildFooter_(settings, lead) {
  const lines = [settings.senderName, settings.businessName];
  if (settings.address) lines.push(settings.address);
  if (normCountry_(lead.country) === 'AU' && settings.abn) {
    lines.push(/^abn/i.test(settings.abn) ? settings.abn : 'ABN: ' + settings.abn);
  }
  return lines.join('\n') + '\n\n' + (settings.unsubText || "Reply STOP and I won't email you again.");
}

/** Returns a problem string if this email would not be compliant to send live, else ''. */
function complianceProblem_(settings, lead) {
  const bad = function (v) { return !v || v.indexOf('[') >= 0; };
  if (!settings.senderName) return 'Settings: Sender name is empty';
  if (!settings.businessName) return 'Settings: Sender business name is empty';
  if (bad(settings.address)) return 'Settings: Business address is still a placeholder';
  if (!settings.unsubText) return 'Settings: Unsubscribe text is empty';
  if (normCountry_(lead.country) === 'AU' && bad(settings.abn)) return 'Settings: ABN is still a placeholder (needed for Australian leads)';
  return '';
}

function buildEmail_(lead, template, kind, settings, firstTemplate) {
  const vars = mergeVars_(lead, settings);
  let subject;
  if (kind === 'first') {
    subject = renderTemplate_(template.subject, vars);
  } else {
    subject = 'Re: ' + (firstTemplate ? renderTemplate_(firstTemplate.subject, vars) : '(same thread)');
  }
  const body = renderTemplate_(template.body, vars).replace(/\s+$/, '') + '\n\n--\n' + buildFooter_(settings, lead);
  return { to: lead.email, subject: subject, body: body };
}

function nextFollowUpDate_(todayStr, newStep) {
  const gap = FOLLOWUP_GAPS[newStep];
  return gap ? addDays_(todayStr, gap) : '';
}

// ---------------------------------------------------------------------------
// Candidate collection (used by Preview and Send)
// ---------------------------------------------------------------------------

function blockMaps_(all) {
  const blocked = {}, contacted = {};
  all.forEach(function (l) {
    if (!l.email) return;
    if (l.status === ST.UNSUB || l.status === ST.BOUNCED) blocked[l.email] = l.status + ' (' + l.sheet + ' row ' + l.row + ')';
    else if ([ST.EMAILED, ST.FOLLOWED, ST.REPLIED, ST.WON].indexOf(l.status) >= 0) contacted[l.email] = l.status + ' (' + l.sheet + ' row ' + l.row + ')';
  });
  return { blocked: blocked, contacted: contacted };
}

function collectCandidates_(settings, now) {
  const today = nzDate_(now);
  const templates = readTemplates_();
  const all = readAllLeads_();
  const maps = blockMaps_(all);
  const items = [], skipped = [], seen = {};

  all.forEach(function (lead) {
    const ev = evaluateLead_(lead, { today: today });
    if (ev.action === 'ignore') return;
    const fail = function (reason) { skipped.push({ lead: lead, reason: reason }); };
    if (ev.action === 'skip') return fail(ev.reason);
    if (maps.blocked[lead.email]) return fail('Same email is Unsubscribed/Bounced elsewhere: ' + maps.blocked[lead.email]);
    if (ev.kind === 'first' && maps.contacted[lead.email]) return fail('Same email already contacted elsewhere: ' + maps.contacted[lead.email]);
    if (seen[lead.email]) return fail('Duplicate email in this batch (' + seen[lead.email] + ')');

    const tpl = findTemplate_(templates, lead.sheet, ev.templateStep);
    if (!tpl) return fail('No template for segment "' + lead.sheet + '" step ' + ev.templateStep);
    let email;
    try {
      email = buildEmail_(lead, tpl, ev.kind, settings, findTemplate_(templates, lead.sheet, 1));
    } catch (e) {
      return fail(e.message);
    }
    const problem = complianceProblem_(settings, lead);
    if (problem && !settings.dryRun) return fail(problem);
    seen[lead.email] = lead.sheet + ' row ' + lead.row;
    items.push({ lead: lead, kind: ev.kind, templateStep: ev.templateStep, email: email, warning: problem });
  });

  // Follow-ups first (oldest due first), then new approved rows in sheet order.
  items.sort(function (a, b) {
    if (a.kind !== b.kind) return a.kind === 'followup' ? -1 : 1;
    if (a.kind === 'followup' && a.lead.nextFollowUp !== b.lead.nextFollowUp) return a.lead.nextFollowUp < b.lead.nextFollowUp ? -1 : 1;
    return 0;
  });
  return { items: items, skipped: skipped };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupOutreach() {
  const ss = SpreadsheetApp.getActive();
  ss.setSpreadsheetTimeZone(NZ_TZ);
  const notes = [];

  // Lead tabs: add missing columns to existing lead-like tabs, as-is otherwise.
  let leadLike = 0;
  ss.getSheets().forEach(function (sh) {
    if (RESERVED_TABS.indexOf(sh.getName()) >= 0) return;
    if (sh.getLastRow() < 1 || sh.getLastColumn() < 1) return;
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const map = headerMap_(header);
    if (map.email === undefined && map.business === undefined) return; // not a lead tab
    leadLike++;
    const missing = LEAD_COLUMNS.filter(function (c) { return map[c.key] === undefined; });
    if (missing.length) {
      sh.getRange(1, sh.getLastColumn() + 1, 1, missing.length).setValues([missing.map(function (c) { return c.header; })]);
      notes.push('Added ' + missing.length + ' column(s) to "' + sh.getName() + '".');
    }
    formatLeadSheet_(sh);
  });

  if (leadLike === 0) {
    ['Property managers', 'Cleaning'].forEach(function (name) {
      if (ss.getSheetByName(name)) return;
      const sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, LEAD_COLUMNS.length).setValues([LEAD_COLUMNS.map(function (c) { return c.header; })]);
      formatLeadSheet_(sh);
      notes.push('Created lead tab "' + name + '".');
    });
  }

  // Templates
  let tsh = ss.getSheetByName(TAB.TEMPLATES);
  if (!tsh) {
    tsh = ss.insertSheet(TAB.TEMPLATES);
    tsh.getRange(1, 1, 1, TEMPLATE_HEADERS.length).setValues([TEMPLATE_HEADERS]);
    const rows = DEFAULT_TEMPLATES.map(function (t) { return [t.segment, t.step, t.subject, t.body]; });
    tsh.getRange(2, 1, rows.length, 4).setValues(rows);
    tsh.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#e8eef7');
    tsh.setColumnWidths(1, 1, 140); tsh.setColumnWidth(2, 50); tsh.setColumnWidth(3, 230); tsh.setColumnWidth(4, 620);
    tsh.getRange(2, 1, rows.length, 4).setVerticalAlignment('top').setWrap(true);
    tsh.setFrozenRows(1);
    notes.push('Created Templates with 8 starter templates.');
  }

  // Settings
  let ssh = ss.getSheetByName(TAB.SETTINGS);
  if (!ssh) {
    ssh = ss.insertSheet(TAB.SETTINGS);
    ssh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'Notes']]).setFontWeight('bold').setBackground('#e8eef7');
    ssh.setColumnWidth(1, 190); ssh.setColumnWidth(2, 320); ssh.setColumnWidth(3, 560);
    ssh.setFrozenRows(1);
  }
  const existing = {};
  if (ssh.getLastRow() >= 2) {
    ssh.getRange(2, 1, ssh.getLastRow() - 1, 1).getValues().forEach(function (r) { existing[str_(r[0]).toLowerCase()] = true; });
  }
  SETTINGS_DEFAULTS.forEach(function (d) {
    if (existing[d[0].toLowerCase()]) return;
    const r = ssh.getLastRow() + 1;
    ssh.getRange(r, 1, 1, 3).setValues([d]);
    if (d[0] === 'Dry run') ssh.getRange(r, 2).insertCheckboxes();
    if (/window/i.test(d[0])) ssh.getRange(r, 2).setNumberFormat('@').setValue(d[1]);
    notes.push('Added setting "' + d[0] + '".');
  });
  ssh.getRange(2, 2, Math.max(ssh.getLastRow() - 1, 1), 1).setHorizontalAlignment('left');

  // Log and Preview
  let lsh = ss.getSheetByName(TAB.LOG);
  if (!lsh) {
    lsh = ss.insertSheet(TAB.LOG);
    lsh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold').setBackground('#e8eef7');
    lsh.setFrozenRows(1);
    lsh.setColumnWidth(1, 150); lsh.setColumnWidth(6, 260); lsh.setColumnWidth(8, 420);
    notes.push('Created Log.');
  }
  if (!ss.getSheetByName(TAB.PREVIEW)) {
    const psh = ss.insertSheet(TAB.PREVIEW);
    psh.getRange(1, 1).setValue('Run Outreach > Preview next batch to fill this tab.');
    notes.push('Created Preview.');
  }

  alert_((notes.length ? notes.join('\n') : 'Everything was already set up.') +
    '\n\nNext: fill in Settings (address, ABN), keep Dry run ticked, then Outreach > Preview next batch.', 'Setup complete');
}

function formatLeadSheet_(sh) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const map = headerMap_(header);
  sh.getRange(1, 1, 1, sh.getLastColumn()).setFontWeight('bold').setBackground('#e8eef7');
  sh.setFrozenRows(1);
  const rows = Math.max(sh.getMaxRows() - 1, 1);
  if (map.status !== undefined) {
    sh.getRange(2, map.status + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).setAllowInvalid(true).build());
  }
  if (map.emailType !== undefined) {
    sh.getRange(2, map.emailType + 1, rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(['named', 'generic'], true).setAllowInvalid(true).build());
  }
  if (map.allowGeneric !== undefined) {
    sh.getRange(2, map.allowGeneric + 1, rows, 1).insertCheckboxes();
  }
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

function log_(mode, lead, subject, step, detail, emailOverride) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.LOG);
  if (!sh) return;
  const r = sh.getLastRow() + 1;
  sh.getRange(r, 1).setNumberFormat('@');
  sh.getRange(r, 1, 1, LOG_HEADERS.length).setValues([[
    nzDateTime_(new Date()), mode, lead ? lead.sheet : '', lead ? lead.row : '',
    emailOverride || (lead ? lead.email : ''), subject || '', step === undefined ? '' : step, detail || ''
  ]]);
}

function countSentToday_(now) {
  const sh = SpreadsheetApp.getActive().getSheetByName(TAB.LOG);
  if (!sh || sh.getLastRow() < 2) return 0;
  const today = nzDate_(now);
  let n = 0;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    if (r[1] === 'SENT' && toDateStr_(r[0]) === today) n++;
  });
  return n;
}

// ---------------------------------------------------------------------------
// Approve selected rows
// ---------------------------------------------------------------------------

function approveSelectedRows() {
  const sh = SpreadsheetApp.getActiveSheet();
  if (!isLeadSheet_(sh)) return alert_('Select rows on a leads tab first. Run Setup if this tab is missing the Status column.');
  const list = sh.getActiveRangeList();
  if (!list) return alert_('Select one or more lead rows first.');
  const rowSet = {};
  list.getRanges().forEach(function (rg) {
    for (let r = rg.getRow(); r < rg.getRow() + rg.getNumRows(); r++) if (r >= 2) rowSet[r] = true;
  });

  const settings = getSettings_();
  const today = nzDate_(new Date());
  const all = readAllLeads_();
  const maps = blockMaps_(all);
  const templates = readTemplates_();
  const approved = [], refused = [];

  readLeads_(sh).filter(function (l) { return rowSet[l.row]; }).forEach(function (lead) {
    const label = 'Row ' + lead.row + ' (' + (lead.business || 'no name') + '): ';
    if (lead.status !== ST.NEW) return refused.push(label + 'status is ' + lead.status + ', only New rows can be approved');
    const ev = evaluateLead_(Object.assign({}, lead, { status: ST.APPROVED }), { today: today });
    if (ev.action !== 'send') return refused.push(label + ev.reason);
    if (maps.blocked[lead.email]) return refused.push(label + 'email is Unsubscribed/Bounced elsewhere');
    if (maps.contacted[lead.email]) return refused.push(label + 'email already contacted elsewhere');
    const tpl = findTemplate_(templates, lead.sheet, 1);
    if (!tpl) return refused.push(label + 'no step 1 template for this tab');
    try { buildEmail_(lead, tpl, 'first', settings, tpl); } catch (e) { return refused.push(label + e.message); }
    writeLead_(lead, { status: ST.APPROVED });
    approved.push(lead.row);
  });

  alert_('Approved ' + approved.length + ' row(s).' +
    (refused.length ? '\n\nNot approved:\n' + refused.join('\n') : '') +
    '\n\nNext: Outreach > Preview next batch.', 'Approve selected rows');
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

function previewNextBatch() {
  const ss = SpreadsheetApp.getActive();
  const settings = getSettings_();
  const now = new Date();
  const sentToday = settings.dryRun ? 0 : countSentToday_(now);
  const remaining = Math.max(settings.cap - sentToday, 0);
  const res = collectCandidates_(settings, now);
  const batch = res.items.slice(0, remaining);

  let sh = ss.getSheetByName(TAB.PREVIEW);
  if (!sh) sh = ss.insertSheet(TAB.PREVIEW);
  sh.clear();
  const mode = settings.dryRun ? 'DRY RUN (nothing will be sent)' :
    (settings.testRecipient ? 'LIVE TEST (everything goes to ' + settings.testRecipient + ' only)' : 'LIVE');
  sh.getRange(1, 1).setValue('Generated ' + nzDateTime_(now) + ' NZ | Mode: ' + mode + ' | Cap ' + settings.cap +
    ', sent today ' + sentToday + ' | In this batch: ' + batch.length + ' of ' + res.items.length + ' eligible | Skipped: ' + res.skipped.length);
  sh.getRange(1, 1).setFontWeight('bold');
  sh.getRange(3, 1, 1, PREVIEW_HEADERS.length).setValues([PREVIEW_HEADERS]).setFontWeight('bold').setBackground('#e8eef7');

  const from = settings.alias || '(your Gmail address)';
  const rows = [];
  batch.forEach(function (it) {
    rows.push([it.lead.sheet, it.lead.row, it.lead.email, from,
      it.kind === 'first' ? 'First email' : 'Follow-up ' + (it.templateStep - 1),
      it.email.subject, it.email.body,
      it.warning ? 'WILL BE BLOCKED LIVE: ' + it.warning : 'OK to send']);
  });
  res.items.slice(batch.length).forEach(function (it) {
    rows.push([it.lead.sheet, it.lead.row, it.lead.email, from,
      it.kind === 'first' ? 'First email' : 'Follow-up ' + (it.templateStep - 1),
      it.email.subject, it.email.body, 'WAITING: over today\'s cap, goes in a later batch']);
  });
  res.skipped.forEach(function (s) {
    rows.push([s.lead.sheet, s.lead.row, s.lead.email, '', '', '', '', 'SKIPPED: ' + s.reason]);
  });
  if (rows.length) {
    sh.getRange(4, 1, rows.length, PREVIEW_HEADERS.length).setValues(rows)
      .setVerticalAlignment('top').setWrap(true);
  }
  sh.setColumnWidth(1, 120); sh.setColumnWidth(2, 45); sh.setColumnWidth(3, 200); sh.setColumnWidth(4, 160);
  sh.setColumnWidth(5, 90); sh.setColumnWidth(6, 220); sh.setColumnWidth(7, 520); sh.setColumnWidth(8, 260);
  sh.setFrozenRows(3);
  ss.setActiveSheet(sh);
  alert_('Preview written to the "' + TAB.PREVIEW + '" tab.\n\nMode: ' + mode + '\nIn this batch: ' + batch.length +
    '\nWaiting (over cap): ' + (res.items.length - batch.length) + '\nSkipped: ' + res.skipped.length, 'Preview');
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

function sendNow() {
  const msg = runSend_(true);
  alert_(msg, 'Send now');
}

function scheduledSend() {
  try {
    if (getSettings_().dryRun) return; // triggers never do anything while Dry run is on
    runSend_(false);
  } catch (e) {
    log_('ERROR', null, '', '', 'scheduledSend: ' + e.message);
  }
}

function runSend_(interactive) {
  const settings = getSettings_();
  const dry = settings.dryRun;
  const testMode = !dry && !!settings.testRecipient;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Another send run is in progress. Try again shortly.';
  try {
    const started = Date.now();
    const now = new Date();

    if (testMode && !validEmail_(settings.testRecipient)) return 'Test recipient is not a valid email address.';
    if (!dry && settings.alias) {
      const aliases = GmailApp.getAliases().map(function (a) { return a.toLowerCase(); });
      if (aliases.indexOf(settings.alias.toLowerCase()) < 0) {
        return 'Sender alias "' + settings.alias + '" is not a "Send mail as" alias of this Gmail account. Fix or clear it in Settings.';
      }
    }

    // Honour opt-outs and replies before anything goes out.
    if (!dry && !testMode) checkReplies_(settings);

    if (!dry && !testMode && !inSendWindow_(now, settings.windowStart, settings.windowEnd)) {
      if (!interactive) return 'Outside send window.';
      if (!confirm_('It is outside the send window (weekdays ' + settings.windowStart + '-' + settings.windowEnd + ' NZ time). Send anyway?')) {
        return 'Cancelled: outside send window.';
      }
    }

    let remaining;
    if (dry) remaining = settings.cap;
    else if (testMode) remaining = Math.min(settings.cap, TEST_MODE_MAX);
    else {
      remaining = settings.cap - countSentToday_(now);
      try { remaining = Math.min(remaining, MailApp.getRemainingDailyQuota()); } catch (e) { /* quota API unavailable */ }
    }
    if (remaining <= 0) return 'Daily cap reached (' + settings.cap + '). Nothing sent.';

    const res = collectCandidates_(settings, now);
    const batch = res.items.slice(0, remaining);
    if (!batch.length) return 'Nothing to send. Eligible: 0, skipped: ' + res.skipped.length + ' (see Preview for reasons).';

    if (!dry) {
      const what = testMode ? 'TEST: send ' + batch.length + ' email(s) to ' + settings.testRecipient + ' only'
        : 'LIVE: send up to ' + batch.length + ' REAL email(s) to the leads shown in Preview';
      if (interactive && !confirm_(what + '.\n\nContinue?')) return 'Cancelled.';
    }

    let sent = 0, errors = 0, dryLogged = 0, stopped = '';
    for (let i = 0; i < batch.length; i++) {
      const it = batch[i];
      const lead = it.lead;
      const step = it.kind === 'first' ? 1 : it.templateStep;

      if (dry) {
        log_('DRYRUN', lead, it.email.subject, step, 'Would send ' + it.kind + ' to ' + lead.email +
          (it.warning ? ' (would be BLOCKED live: ' + it.warning + ')' : ''));
        dryLogged++;
        continue;
      }

      if (sent + errors > 0) {
        const gap = MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS + 1));
        if (Date.now() - started + gap + RUN_MARGIN_MS > RUN_LIMIT_MS) { stopped = 'Time budget reached, run again to continue.'; break; }
        Utilities.sleep(gap);
      }

      try {
        // Last-second opt-out check for follow-ups.
        if (it.kind === 'followup' && !testMode) {
          const cls = classifyLeadThread_(lead, settings);
          if (cls) { applyClassification_(lead, cls); continue; }
        }
        const out = sendOne_(it, settings, testMode);
        if (testMode) {
          log_('TEST', lead, '[TEST] ' + it.email.subject, step, 'Sent to test recipient ' + settings.testRecipient + ' (lead untouched)', settings.testRecipient);
        } else {
          log_('SENT', lead, it.email.subject, step, it.kind + (out.threadId ? '' : ' (thread id not found)'));
          recordSend_(it, now, out.threadId);
        }
        sent++;
      } catch (e) {
        errors++;
        log_('ERROR', lead, it.email.subject, step, e.message);
        if (e.fatal || errors >= 3) { stopped = 'Stopped after error: ' + e.message; break; }
      }
    }

    if (dry) return 'DRY RUN: ' + dryLogged + ' email(s) would be sent. Nothing was sent. See Log and Preview.';
    return (testMode ? 'TEST run: ' : 'Live run: ') + sent + ' sent, ' + errors + ' error(s).' +
      (stopped ? '\n' + stopped : '') +
      (!stopped && res.items.length > batch.length ? '\n' + (res.items.length - batch.length) + ' more waiting for the next run/day.' : '');
  } finally {
    lock.releaseLock();
  }
}

function sendOne_(item, settings, testMode) {
  const lead = item.lead, em = item.email;
  const opts = { name: settings.senderName };
  if (settings.alias) opts.from = settings.alias;

  if (testMode) {
    GmailApp.sendEmail(settings.testRecipient, '[TEST] ' + em.subject, em.body, opts);
    return {};
  }

  if (item.kind === 'followup') {
    const thread = getThread_(lead);
    if (!thread) throw new Error('Original Gmail thread not found, follow-up not sent');
    thread.reply(em.body, opts);
    // Safety: confirm the reply went to the lead and not somewhere else.
    const msgs = GmailApp.getThreadById(thread.getId()).getMessages();
    const to = (msgs[msgs.length - 1].getTo() || '').toLowerCase();
    if (to.indexOf(lead.email) < 0) {
      const err = new Error('Follow-up recipient mismatch (went to "' + to + '"). Run stopped, check your Sent folder.');
      err.fatal = true;
      throw err;
    }
    return { threadId: thread.getId() };
  }

  GmailApp.sendEmail(lead.email, em.subject, em.body, opts);
  return { threadId: findSentThread_(lead.email, em.subject) };
}

function findSentThread_(email, subject) {
  const q = 'in:sent to:' + email + ' subject:"' + subject.replace(/["\\]/g, '') + '"';
  for (let attempt = 0; attempt < 4; attempt++) {
    Utilities.sleep(1500);
    const threads = GmailApp.search(q, 0, 3);
    for (let i = 0; i < threads.length; i++) {
      if (threads[i].getFirstMessageSubject() === subject) return threads[i].getId();
    }
    if (threads.length) return threads[0].getId();
  }
  return '';
}

function getThread_(lead) {
  if (lead.threadId) {
    try { const t = GmailApp.getThreadById(lead.threadId); if (t) return t; } catch (e) { /* fall through */ }
  }
  const found = GmailApp.search('in:sent to:' + lead.email, 0, 1);
  return found.length ? found[0] : null;
}

function recordSend_(item, now, threadId) {
  const lead = item.lead;
  const first = item.kind === 'first';
  const newStep = first ? 0 : lead.step + 1;
  const updates = {
    status: first ? ST.EMAILED : ST.FOLLOWED,
    step: newStep,
    lastSent: nzDateTime_(now),
    nextFollowUp: nextFollowUpDate_(nzDate_(now), newStep)
  };
  if (threadId) updates.threadId = threadId;
  writeLead_(lead, updates);
}

// ---------------------------------------------------------------------------
// Replies, bounces, opt-outs
// ---------------------------------------------------------------------------

const UNSUB_RE = /\b(stop|unsubscribe|remove me|remove us|opt[\s-]?out|take me off|do not (email|contact)|don'?t (email|contact))\b/i;
const BOUNCE_FROM_RE = /mailer-daemon|postmaster|mail delivery (sub)?system/i;
const BOUNCE_SUBJECT_RE = /delivery status notification|undeliverable|undelivered mail|returned mail|delivery failure|failure notice|mail delivery failed/i;

function parseAddress_(from) {
  const m = /<([^>]+)>/.exec(from || '');
  return (m ? m[1] : str_(from)).toLowerCase();
}

function stripQuoted_(body) {
  const cut = String(body || '').split(/\r?\n\s*On [\s\S]{0,200}?wrote:/)[0].split(/\r?\n-{2,}\s*Original Message/i)[0];
  return cut.split(/\r?\n/).filter(function (l) { return !/^\s*>/.test(l); }).join('\n');
}

/**
 * Pure. msgs = [{from, subject, body}], myEmails = lowercased addresses that are "us".
 * Returns '' (no reply), 'Replied', 'Unsubscribed' or 'Bounced'.
 */
function classifyMessages_(msgs, myEmails) {
  let replied = false, unsub = false, bounced = false;
  msgs.forEach(function (m) {
    if (myEmails.indexOf(parseAddress_(m.from)) >= 0) return;
    if (BOUNCE_FROM_RE.test(m.from || '') || BOUNCE_SUBJECT_RE.test(m.subject || '')) { bounced = true; return; }
    replied = true;
    if (UNSUB_RE.test(stripQuoted_(m.body).slice(0, 1500))) unsub = true;
  });
  if (unsub) return ST.UNSUB;
  if (bounced) return ST.BOUNCED;
  if (replied) return ST.REPLIED;
  return '';
}

function myEmails_(settings) {
  let mine = [];
  try { mine.push(Session.getEffectiveUser().getEmail()); } catch (e) { /* ignore */ }
  try { mine.push(Session.getActiveUser().getEmail()); } catch (e) { /* ignore */ }
  try { mine = mine.concat(GmailApp.getAliases()); } catch (e) { /* ignore */ }
  if (settings.alias) mine.push(settings.alias);
  return mine.filter(String).map(function (a) { return a.toLowerCase(); });
}

function classifyLeadThread_(lead, settings) {
  const thread = getThread_(lead);
  if (!thread) return '';
  const msgs = thread.getMessages().map(function (m) {
    return { from: m.getFrom(), subject: m.getSubject(), body: m.getPlainBody() };
  });
  return classifyMessages_(msgs, myEmails_(settings));
}

function applyClassification_(lead, cls) {
  writeLead_(lead, { status: cls, nextFollowUp: '' });
  appendNote_(lead, 'Auto: ' + cls + ' ' + nzDate_(new Date()));
  log_('REPLY', lead, '', lead.step, 'Status set to ' + cls + ', sequence stopped');
}

function checkReplies_(settings) {
  const mine = myEmails_(settings);
  const counts = { checked: 0, Replied: 0, Unsubscribed: 0, Bounced: 0 };
  const leads = readAllLeads_();
  const byEmail = {};

  leads.forEach(function (lead) {
    if (CONTACTED.indexOf(lead.status) < 0) return;
    byEmail[lead.email] = lead;
  });

  Object.keys(byEmail).forEach(function (email) {
    const lead = byEmail[email];
    if (!lead.threadId) return;
    let cls = '';
    try {
      const thread = GmailApp.getThreadById(lead.threadId);
      if (!thread) return;
      counts.checked++;
      cls = classifyMessages_(thread.getMessages().map(function (m) {
        return { from: m.getFrom(), subject: m.getSubject(), body: m.getPlainBody() };
      }), mine);
    } catch (e) {
      log_('ERROR', lead, '', lead.step, 'Reply check failed: ' + e.message);
      return;
    }
    if (cls) { applyClassification_(lead, cls); counts[cls]++; delete byEmail[email]; }
  });

  // Bounce notices often arrive as separate threads from mailer-daemon.
  try {
    const threads = GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:30d', 0, 50);
    threads.forEach(function (t) {
      t.getMessages().forEach(function (m) {
        const found = String(m.getPlainBody() || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
        found.forEach(function (addr) {
          const lead = byEmail[addr.toLowerCase()];
          if (lead && mine.indexOf(addr.toLowerCase()) < 0) {
            applyClassification_(lead, ST.BOUNCED);
            counts.Bounced++;
            delete byEmail[addr.toLowerCase()];
          }
        });
      });
    });
  } catch (e) {
    log_('ERROR', null, '', '', 'Bounce scan failed: ' + e.message);
  }
  return counts;
}

function checkRepliesMenu() {
  const settings = getSettings_();
  const c = checkReplies_(settings);
  alert_('Threads checked: ' + c.checked + '\nReplied: ' + c.Replied + '\nUnsubscribed: ' + c.Unsubscribed + '\nBounced: ' + c.Bounced, 'Check replies');
}

function scheduledCheckReplies() {
  try { checkReplies_(getSettings_()); } catch (e) { log_('ERROR', null, '', '', 'scheduledCheckReplies: ' + e.message); }
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

function removeTriggers() {
  const ours = ['scheduledSend', 'scheduledCheckReplies'];
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (ours.indexOf(t.getHandlerFunction()) >= 0) { ScriptApp.deleteTrigger(t); n++; }
  });
  return n;
}

function installDailyTriggers() {
  removeTriggers();
  ScriptApp.newTrigger('scheduledSend').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('scheduledCheckReplies').timeBased().everyHours(2).create();
  alert_('Installed:\n- Hourly send run (does nothing while Dry run is ticked, and only sends inside the send window, up to the daily cap).\n' +
    '- Reply, bounce and opt-out check every 2 hours.\n\nAuthorisation was granted when you ran this. Remove them any time with Outreach > Remove triggers.', 'Triggers installed');
}

// ---------------------------------------------------------------------------
// Self-test (no email is ever sent, no real data is used)
// ---------------------------------------------------------------------------

function runDryRunTest() {
  const results = [];
  const check = function (name, cond) { results.push({ name: name, ok: !!cond }); };
  const settings = parseSettings_({
    'dry run': true, 'daily send cap': 10, 'sender name': 'Test Sender', 'sender business name': 'Test Biz Ltd',
    'business address': '1 Test Street, Christchurch 8011', 'abn (australia)': 'ABN 00 000 000 000',
    'unsubscribe text': "Reply STOP and I won't email you again."
  });
  const today = '2026-11-04';
  const base = { sheet: 'Test', row: 2, business: 'Dummy Co', city: 'Testville', country: 'New Zealand', email: 'person@example.invalid',
    emailType: 'named', status: ST.APPROVED, nextFollowUp: '', step: 0, lastSent: '', threadId: '', allowGeneric: false, firstName: '' };
  const make = function (o) { return Object.assign({}, base, o); };
  const ev = function (o) { return evaluateLead_(make(o), { today: today }); };

  // Eligibility
  check('Approved NZ named row is sent', ev({}).action === 'send' && ev({}).kind === 'first');
  check('Row without email is skipped', ev({ email: '' }).action === 'skip');
  check('Invalid email is skipped', ev({ email: 'not-an-email' }).action === 'skip');
  check('New (unapproved) row is not sent', ev({ status: ST.NEW }).action === 'ignore');
  [ST.UNSUB, ST.BOUNCED, ST.REPLIED, ST.WON].forEach(function (s) {
    check('Status ' + s + ' is never sent', ev({ status: s }).action === 'ignore');
  });
  check('AU generic (info@) blocked', ev({ country: 'Australia', email: 'info@example.invalid', emailType: 'generic' }).action === 'skip');
  check('AU generic blocked even if typed as named', ev({ country: 'AU', email: 'admin@example.invalid', emailType: 'named' }).action === 'skip');
  check('AU generic allowed with tick', ev({ country: 'AU', email: 'info@example.invalid', emailType: 'generic', allowGeneric: true }).action === 'send');
  check('AU named email sent', ev({ country: 'Australia', email: 'sam.lee@example.invalid' }).action === 'send');
  check('NZ generic email allowed', ev({ email: 'hello@example.invalid', emailType: 'generic' }).action === 'send');
  check('Unknown country skipped', ev({ country: '' }).action === 'skip');
  check('Approved but already contacted is skipped', ev({ step: 1, threadId: 'abc' }).action === 'skip');
  check('Due follow-up gets template step 2', (function () { const e = ev({ status: ST.EMAILED, nextFollowUp: '2026-11-04', threadId: 't', lastSent: 'x' }); return e.action === 'send' && e.kind === 'followup' && e.templateStep === 2; })());
  check('Overdue follow-up step 2 gets template 4', (function () { const e = ev({ status: ST.FOLLOWED, step: 2, nextFollowUp: '2026-11-01', threadId: 't' }); return e.action === 'send' && e.templateStep === 4; })());
  check('Future follow-up not sent', ev({ status: ST.EMAILED, nextFollowUp: '2026-11-05', threadId: 't' }).action === 'ignore');
  check('Finished sequence not sent', ev({ status: ST.FOLLOWED, step: 3, nextFollowUp: '2026-11-01', threadId: 't' }).action === 'ignore');
  check('Replied row with due date not sent', ev({ status: ST.REPLIED, nextFollowUp: '2026-11-01' }).action === 'ignore');

  // Scheduling
  check('Follow-up gaps give day 3, 7, 14', nextFollowUpDate_('2026-11-04', 0) === '2026-11-07' &&
    nextFollowUpDate_('2026-11-07', 1) === '2026-11-11' && nextFollowUpDate_('2026-11-11', 2) === '2026-11-18' &&
    nextFollowUpDate_('2026-11-18', 3) === '');
  const nzDay = function (iso) { return new Date(iso); };
  check('Window: Wednesday 10:00 NZ is open', inSendWindow_(nzDay('2026-11-03T21:00:00Z'), '08:30', '16:00'));
  check('Window: Wednesday 08:00 NZ is closed', !inSendWindow_(nzDay('2026-11-03T19:00:00Z'), '08:30', '16:00'));
  check('Window: Wednesday 16:30 NZ is closed', !inSendWindow_(nzDay('2026-11-04T03:30:00Z'), '08:30', '16:00'));
  check('Window: Saturday 10:00 NZ is closed', !inSendWindow_(nzDay('2026-11-06T21:00:00Z'), '08:30', '16:00'));

  // Settings
  check('Dry run defaults to ON when blank', parseSettings_({}).dryRun === true);
  check('Dry run only off when explicitly off', parseSettings_({ 'dry run': false }).dryRun === false && parseSettings_({ 'dry run': 'maybe' }).dryRun === true);
  check('Cap is clamped to the maximum', parseSettings_({ 'daily send cap': 500 }).cap === MAX_DAILY_CAP);

  // Rendering and compliance
  const tplNZ = DEFAULT_TEMPLATES[0];
  const mail = buildEmail_(make({}), tplNZ, 'first', settings, tplNZ);
  check('Rendered email has no leftover merge fields', !/\{\{/.test(mail.subject + mail.body));
  check('Footer has sender, business, address and opt-out', ['Test Sender', 'Test Biz Ltd', '1 Test Street', "Reply STOP and I won't email you again."].every(function (s) { return mail.body.indexOf(s) >= 0; }));
  check('NZ email has no ABN line', mail.body.indexOf('ABN') < 0);
  const mailAU = buildEmail_(make({ country: 'Australia' }), tplNZ, 'first', settings, tplNZ);
  check('AU email has ABN line', mailAU.body.indexOf('ABN 00 000 000 000') >= 0);
  check('Unnamed lead greeted as "there"', mail.body.indexOf('Hi there,') === 0);
  check('Named email with separator gets first name', deriveFirstName_(make({ email: 'sam.lee@example.invalid' })) === 'Sam');
  check('Single-token local part is not guessed', deriveFirstName_(make({ email: 'jsmith@example.invalid' })) === 'there');
  check('Follow-up subject is Re: of first subject', buildEmail_(make({ status: ST.EMAILED }), DEFAULT_TEMPLATES[1], 'followup', settings, tplNZ).subject === 'Re: ' + mail.subject);
  check('Empty merge field throws', (function () { try { buildEmail_(make({ city: '' }), tplNZ, 'first', settings, tplNZ); return false; } catch (e) { return true; } })());
  check('Placeholder address blocks live sending', complianceProblem_(parseSettings_({ 'sender name': 'A', 'sender business name': 'B', 'business address': '[Add]', 'unsubscribe text': 'x' }), make({})) !== '');
  check('Placeholder ABN blocks AU only', complianceProblem_(parseSettings_({ 'sender name': 'A', 'sender business name': 'B', 'business address': 'Real St', 'abn (australia)': '[Add]', 'unsubscribe text': 'x' }), make({})) === '' &&
    complianceProblem_(parseSettings_({ 'sender name': 'A', 'sender business name': 'B', 'business address': 'Real St', 'abn (australia)': '[Add]', 'unsubscribe text': 'x' }), make({ country: 'AU' })) !== '');

  // Starter templates
  const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  const vars = { business: 'Dummy Co', city: 'Testville', first_name: 'there', sender: 'Test Sender' };
  check('8 starter templates (4 x 2 segments)', DEFAULT_TEMPLATES.length === 8);
  DEFAULT_TEMPLATES.forEach(function (t) {
    const text = renderTemplate_(t.body, vars);
    const words = text.split(/\s+/).filter(String).length;
    check(t.segment + ' step ' + t.step + ' under 90 words (' + words + ')', words < 90);
    check(t.segment + ' step ' + t.step + ' has no em/en dash or emoji', !/[\u2013\u2014]/.test(t.subject + t.body) && !emoji.test(t.subject + t.body));
  });

  // Reply, bounce and opt-out detection
  const me = ['me@example.invalid'];
  const sent = { from: 'Test Sender <me@example.invalid>', subject: 'Hi', body: 'Hello' };
  check('No reply detected when only we sent', classifyMessages_([sent], me) === '');
  check('Any reply sets Replied', classifyMessages_([sent, { from: 'Lead <lead@example.invalid>', subject: 'Re: Hi', body: 'Sounds interesting, call me' }], me) === ST.REPLIED);
  check('Quoted footer does not trigger opt-out', classifyMessages_([sent, { from: 'lead@example.invalid', subject: 'Re: Hi', body: 'Yes please\n\nOn Mon, 3 Nov 2026 at 9:00 AM Test <me@example.invalid> wrote:\n> Reply STOP and I won\'t email you again.' }], me) === ST.REPLIED);
  ['STOP', 'Please unsubscribe me', 'remove me from your list', 'opt out', 'Opt-out please'].forEach(function (txt) {
    check('Opt-out detected: "' + txt + '"', classifyMessages_([sent, { from: 'lead@example.invalid', subject: 'Re: Hi', body: txt }], me) === ST.UNSUB);
  });
  check('Bounce detected from mailer-daemon', classifyMessages_([sent, { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', subject: 'Delivery Status Notification (Failure)', body: 'Address not found' }], me) === ST.BOUNCED);

  const failed = results.filter(function (r) { return !r.ok; });
  const summary = (results.length - failed.length) + ' of ' + results.length + ' checks passed. No email was sent and no lead data was used.' +
    (failed.length ? '\n\nFAILED:\n' + failed.map(function (f) { return '- ' + f.name; }).join('\n') : '');
  Logger.log(summary);
  results.forEach(function (r) { Logger.log((r.ok ? 'PASS ' : 'FAIL ') + r.name); });
  alert_(summary, 'Self-test');
  return { passed: results.length - failed.length, total: results.length, failed: failed.map(function (f) { return f.name; }) };
}
