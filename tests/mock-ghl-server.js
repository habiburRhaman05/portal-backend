const express = require('express');

function createMockGhlServer() {
  const app = express();
  app.use(express.json());

  const contacts = {};
  const notes = {};
  const tasks = {};
  const customFields = {};
  let nextId = 1000;

  function genId() { return 'mock_' + (nextId++); }

  app.get('/contacts/v1/contact/search/duplicate', (req, res) => {
    const email = (req.query.email || '').toLowerCase();
    const found = Object.values(contacts).find(c => c.email === email);
    if (found) {
      res.json({ contact: found });
    } else {
      res.status(200).json({ contact: null });
    }
  });

  app.get('/contacts/:id', (req, res) => {
    const c = contacts[req.params.id];
    if (!c) return res.status(404).json({ message: 'Contact not found' });
    res.json({ contact: c });
  });

  app.put('/contacts/:id', (req, res) => {
    const c = contacts[req.params.id];
    if (!c) return res.status(404).json({ message: 'Contact not found' });
    Object.assign(c, req.body);
    if (req.body.customFields) {
      c.customFields = c.customFields || [];
      for (const cf of req.body.customFields) {
        const existing = c.customFields.find(x => x.id === cf.id);
        if (existing) existing.value = cf.value;
        else c.customFields.push(cf);
      }
    }
    res.json({ contact: c });
  });

  app.post('/contacts/search', (req, res) => {
    const results = Object.values(contacts).filter(c => {
      if (req.body.query) {
        return c.email?.includes(req.body.query) || c.firstName?.includes(req.body.query);
      }
      return true;
    });
    res.json({ contacts: results, total: results.length });
  });

  app.post('/contacts/:id/notes', (req, res) => {
    const id = genId();
    const note = { id, contactId: req.params.id, body: req.body.body, dateAdded: new Date().toISOString() };
    notes[id] = note;
    if (!contacts[req.params.id]) return res.status(404).json({ message: 'Contact not found' });
    res.status(201).json({ note });
  });

  app.post('/contacts/:id/tasks', (req, res) => {
    const id = genId();
    const task = { id, contactId: req.params.id, ...req.body, dateAdded: new Date().toISOString() };
    tasks[id] = task;
    if (!contacts[req.params.id]) return res.status(404).json({ message: 'Contact not found' });
    res.status(201).json({ task });
  });

  app.get('/locations/:id/customFields', (req, res) => {
    res.json({ customFields: Object.values(customFields) });
  });

  app.post('/locations/:id/customFields', (req, res) => {
    const id = genId();
    const cf = { id, ...req.body };
    customFields[id] = cf;
    res.status(201).json({ customField: cf });
  });

  app.get('/locations/:id/customFields/folders', (req, res) => {
    res.json({ folders: [] });
  });

  function addContact(data) {
    const id = data.id || genId();
    contacts[id] = { id, customFields: [], ...data };
    return contacts[id];
  }

  function getContacts() { return contacts; }
  function getNotes() { return notes; }
  function getTasks() { return tasks; }
  function reset() {
    for (const k of Object.keys(contacts)) delete contacts[k];
    for (const k of Object.keys(notes)) delete notes[k];
    for (const k of Object.keys(tasks)) delete tasks[k];
    for (const k of Object.keys(customFields)) delete customFields[k];
    nextId = 1000;
  }

  return { app, addContact, getContacts, getNotes, getTasks, reset };
}

module.exports = { createMockGhlServer };
