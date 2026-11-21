'use strict';

const { dialog, BrowserWindow } = require('electron');
const interruption = require('../core/interruption');

async function ask(options) {
  const parent = BrowserWindow.getFocusedWindow();
  const settings = {
    type: 'question',
    title: 'EDEN · Remove scheduled item',
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    ...options
  };

  const result = parent
    ? await dialog.showMessageBox(parent, settings)
    : await dialog.showMessageBox(settings);

  interruption.checkpoint();
  return result.response;
}

async function deleteSchedule({ parsed, native, localDate }) {
  const reminder = parsed.action === 'delete-reminder';

  const reply = (text, verified = false) => ({
    reply: text,
    model: 'EDEN-SCHEDULE',
    action: 'schedule-deletion',
    verified
  });

  const title = typeof parsed.title === 'string'
    ? parsed.title.trim()
    : '';

  if (!title || title.length > 300) {
    return reply('Please name the particular reminder or event to remove.');
  }

  const request = {
    action: reminder ? 'list-reminders' : 'list-events',
    query: title
  };

  if (parsed.startLocal || parsed.endLocal) {
    if (!parsed.startLocal || !parsed.endLocal) {
      return reply('Please include the date or date range to search.');
    }

    request.start = localDate(parsed.startLocal).getTime() / 1000;
    request.end = localDate(parsed.endLocal).getTime() / 1000;

    if (
      request.end <= request.start ||
      request.end - request.start > 366 * 86400
    ) {
      return reply('Please use a date range within one year.');
    }
  } else if (!reminder) {
    return reply(
      'Which date is the event on? Please repeat its title and date.'
    );
  }

  const result = await native(request);
  interruption.checkpoint();

  if (!Array.isArray(result.items)) {
    throw new Error('Apple returned an invalid search result.');
  }

  if (!result.items.length) {
    return reply(
      'No matching ' + (reminder ? 'pending reminder' : 'Calendar event') +
      ' was found. Nothing was deleted.'
    );
  }

  if (result.total > result.items.length) {
    return reply(
      'There are too many matches. Please give a more specific title or date.'
    );
  }

  const exact = result.items.filter(item =>
    String(item.title).toLowerCase() === title.toLowerCase()
  );

  const items = exact.length ? exact : result.items;

  if (items.length > 8) {
    return reply(
      'Several items match. Please give a more specific title or date.'
    );
  }

  const describe = item => {
    const date = Number.isFinite(item.start)
      ? new Date(item.start * 1000).toLocaleString('en-IN')
      : 'No due date';

    return `${item.title}\n${date}\n${item.calendarName || 'Apple calendar/list'}`;
  };

  let item = items[0];

  if (items.length > 1) {
    const selection = await ask({
      message: 'Which item should I remove?',
      detail: items.map((value, index) =>
        `${index + 1}. ${describe(value)}`
      ).join('\n\n'),
      buttons: ['Cancel', ...items.map((_, index) =>
        `Choose ${index + 1}`
      )]
    });

    if (!selection) return reply('Cancelled. Nothing was deleted.');
    item = items[selection - 1];
  }

  if (!item || item.writable !== true) {
    return reply('That item is read-only. Nothing was deleted.');
  }

  let scope = 'one';
  let buttons = ['Cancel', 'Delete'];
  let explanation = 'Remove this item?';

  if (reminder && item.recurring) {
    buttons = ['Cancel', 'Delete Repeating Reminder'];
    explanation =
      'Delete this repeating reminder and stop its future repeats? ' +
      'This does not skip just one occurrence.';
    scope = 'reminder';
  } else if (!reminder && item.recurring) {
    buttons = [
      'Cancel',
      'Delete This Occurrence',
      'Delete This and Future Occurrences'
    ];
    explanation =
      'Choose which occurrences to remove. Earlier occurrences remain.';
  }

  const approval = await ask({
    message: explanation,
    detail: describe(item),
    buttons
  });

  if (!approval) return reply('Cancelled. Nothing was deleted.');

  if (!reminder && item.recurring && approval === 2) {
    scope = 'future';
  }

  interruption.checkpoint();

  // Only a native search result supplies the identifier and snapshot.
  // The language model never chooses an item identifier to delete.
  const removed = await native({
    action: reminder ? 'delete-reminder' : 'delete-event',
    expected: item,
    scope
  });

  interruption.checkpoint();

  if (removed.deleted !== true || removed.id !== item.id) {
    throw new Error(
      'Removal could not be verified. Check the Apple app before retrying.'
    );
  }

  return reply(
    reminder
      ? `Deleted the reminder "${item.title}".` +
        (item.recurring ? ' Its future repeats are stopped.' : '')
      : `Deleted "${item.title}"` +
        (scope === 'future'
          ? ' for the selected occurrence and future occurrences.'
          : ' for the selected occurrence.'),
    true
  );
}

module.exports = { deleteSchedule };
