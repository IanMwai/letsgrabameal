import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import './App.css';
import {
  addContact,
  deleteContact,
  getContactDetails,
  getContacts,
  logInteraction,
  updateContact,
  updateInteraction,
} from './api';

interface Interaction {
  id: number;
  contact_id: number;
  type: string;
  date: string;
  notes: string;
}

interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  birthday: string | null;
  frequency_days: number;
  tags: string;
  preferred_contact_method: string;
  preferred_meeting_method: string;
  last_contact_date: string | null;
  days_since_contact: number;
  latestInteraction?: Interaction | null;
  interactions?: Interaction[];
}

type IconProps = {
  size?: number;
  className?: string;
};

type ContactStatus = 'hot' | 'soon' | 'ok';

const SvgIcon: React.FC<React.PropsWithChildren<IconProps>> = ({
  size = 20,
  className,
  children,
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

const UserPlus: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
    <circle cx="9.5" cy="7" r="4" />
    <path d="M19 8v6" />
    <path d="M16 11h6" />
  </SvgIcon>
);

const Trash2: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </SvgIcon>
);

const CheckCircle: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="m9 12 2 2 4-4" />
  </SvgIcon>
);

const X: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </SvgIcon>
);

const Edit2: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 20h9" />
    <path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" />
  </SvgIcon>
);

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

const fullDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

const TAG_OPTIONS = ['Family', 'Harvard', 'LinkedIn connection', 'Home', 'KU', 'Church', 'Conferences', 'Other'];
const CONTACT_METHODS = ['Texting', 'Calling', 'Emailing', 'Message (WhatsApp/Telegram)', 'Other'];
const CATCH_UP_METHODS = ['In-person', 'Texting', 'Video Call', 'Voice Call', 'Other'];

const parseAppDate = (value: string) => {
  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(value);
};

const formatShortDate = (value: string) => shortDateFormatter.format(parseAppDate(value));
const formatFullDateTime = (value: string) => fullDateTimeFormatter.format(parseAppDate(value));

const formatDateTimeInputValue = (value: string) => {
  const parsedDate = parseAppDate(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return '';
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  const hours = String(parsedDate.getHours()).padStart(2, '0');
  const minutes = String(parsedDate.getMinutes()).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const getNowDateTimeInputValue = () => formatDateTimeInputValue(new Date().toISOString());

const toIsoDateTime = (value: string) => {
  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString();
};

const formatRelativeTime = (value: string) => {
  const diffMs = Date.now() - parseAppDate(value).getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return 'less than a minute ago';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
};

const splitTags = (value: string | null | undefined) =>
  value
    ? value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.error || error.response?.data?.message;

    if (detail) return `${fallback} ${detail}`;
    if (error.response?.status) return `${fallback} Request failed with status ${error.response.status}.`;
  }

  return fallback;
};

const getContactName = (contact: Contact) =>
  [contact.first_name, contact.last_name].filter(Boolean).join(' ').trim();

const getInitials = (contact: Contact) =>
  `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`.toUpperCase() || '?';

const getContactStatus = (contact: Contact): ContactStatus => {
  const daysSince = contact.days_since_contact || 0;
  const frequency = contact.frequency_days || 30;

  if (daysSince >= frequency) return 'hot';
  if ((frequency - daysSince) / frequency <= 0.1) return 'soon';
  return 'ok';
};

const getLastTouch = (contact: Contact) => {
  const latest = contact.latestInteraction || contact.interactions?.[0];

  if (latest?.notes?.trim()) return latest.notes.trim();
  if (latest?.type) return `${latest.type} logged without notes.`;
  return 'No interaction notes yet.';
};

const getStatusText = (contact: Contact) => {
  const status = getContactStatus(contact);

  if (!contact.last_contact_date) return 'Never contacted';
  if (status === 'hot') return `${contact.days_since_contact} days since last touch`;
  if (status === 'soon') return `Due in ${Math.max(0, contact.frequency_days - contact.days_since_contact)} days`;

  return formatRelativeTime(contact.last_contact_date);
};

const App: React.FC = () => {
  const [appError, setAppError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [birthday, setBirthday] = useState('');
  const [newFreq, setNewFreq] = useState(30);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [prefContact, setPrefContact] = useState('Texting');
  const [prefMeeting, setPrefMeeting] = useState('In-person');

  const [timelineContact, setTimelineContact] = useState<Contact | null>(null);
  const [logContact, setLogContact] = useState<Contact | null>(null);
  const [interactionNotes, setInteractionNotes] = useState('');
  const [interactionType, setInteractionType] = useState('Meeting');
  const [interactionDateTime, setInteractionDateTime] = useState(getNowDateTimeInputValue());
  const [editingInteractionId, setEditingInteractionId] = useState<number | null>(null);
  const editingContact = editingId ? contacts.find((contact) => contact.id === editingId) || null : null;

  const contactColumns = useMemo(
    () => [
      {
        key: 'hot',
        title: 'Needs a nudge',
        countClass: 'chip red',
        contacts: contacts.filter((contact) => getContactStatus(contact) === 'hot'),
      },
      {
        key: 'soon',
        title: 'Coming up',
        countClass: 'chip amber',
        contacts: contacts.filter((contact) => getContactStatus(contact) === 'soon'),
      },
      {
        key: 'ok',
        title: 'Feeling good',
        countClass: 'chip green',
        contacts: contacts.filter((contact) => getContactStatus(contact) === 'ok'),
      },
    ],
    [contacts],
  );

  const fetchContacts = async () => {
    try {
      const res = await getContacts();
      setContacts(res.data);
      setAppError('');
    } catch (err) {
      setAppError(getErrorMessage(err, 'Could not load contacts.'));
      console.error('Failed to load contacts:', err);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const resetForm = () => {
    setFirstName('');
    setLastName('');
    setBirthday('');
    setNewFreq(30);
    setSelectedTags([]);
    setPrefContact('Texting');
    setPrefMeeting('In-person');
    setIsEditing(false);
    setEditingId(null);
  };

  const closeContactForm = () => {
    resetForm();
    setShowAddForm(false);
  };

  const resetInteractionForm = () => {
    setInteractionType('Meeting');
    setInteractionNotes('');
    setInteractionDateTime(getNowDateTimeInputValue());
    setEditingInteractionId(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setAppError('');

    const contactData = {
      first_name: firstName,
      last_name: lastName,
      birthday,
      frequency_days: newFreq,
      tags: selectedTags,
      preferred_contact_method: prefContact,
      preferred_meeting_method: prefMeeting,
    };

    try {
      if (isEditing && editingId) {
        await updateContact(editingId, contactData);
      } else {
        await addContact(contactData);
      }

      resetForm();
      setShowAddForm(false);
      await fetchContacts();
    } catch (err) {
      setAppError(getErrorMessage(err, isEditing ? 'Could not update contact.' : 'Could not add contact.'));
      console.error('Failed to save contact:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditContact = (contact: Contact) => {
    setFirstName(contact.first_name);
    setLastName(contact.last_name || '');
    setBirthday(contact.birthday || '');
    setNewFreq(contact.frequency_days);
    setSelectedTags(splitTags(contact.tags));
    setPrefContact(contact.preferred_contact_method || 'Texting');
    setPrefMeeting(contact.preferred_meeting_method || 'In-person');
    setIsEditing(true);
    setEditingId(contact.id);
    setShowAddForm(true);
  };

  const handleDeleteContact = async (contact: Contact) => {
    if (!confirm(`Delete ${getContactName(contact)}?`)) return;

    setIsSaving(true);
    setAppError('');

    try {
      await deleteContact(contact.id);
      await fetchContacts();
      if (timelineContact?.id === contact.id) setTimelineContact(null);
      if (logContact?.id === contact.id) setLogContact(null);
      if (editingId === contact.id) {
        closeContactForm();
      }
    } catch (err) {
      setAppError(getErrorMessage(err, 'Could not delete contact.'));
      console.error('Failed to delete contact:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const openLogModal = (contact: Contact) => {
    setLogContact(contact);
    resetInteractionForm();
  };

  const closeLogModal = () => {
    setLogContact(null);
    resetInteractionForm();
  };

  const openTimeline = async (contact: Contact) => {
    try {
      const res = await getContactDetails(contact.id);
      setTimelineContact(res.data);
      setAppError('');
    } catch (err) {
      setAppError(getErrorMessage(err, 'Could not load timeline.'));
      console.error('Failed to load contact details:', err);
    }
  };

  const refreshOpenContact = async (contactId: number) => {
    await fetchContacts();

    if (timelineContact?.id === contactId) {
      const res = await getContactDetails(contactId);
      setTimelineContact(res.data);
    }
  };

  const handleQuickLog = async () => {
    if (!logContact) return;
    setIsSaving(true);
    setAppError('');

    try {
      await logInteraction({
        contact_id: logContact.id,
        type: 'Meeting',
        date: new Date().toISOString(),
        notes: '',
      });
      await refreshOpenContact(logContact.id);
      closeLogModal();
    } catch (err) {
      setAppError(getErrorMessage(err, 'Could not quick log interaction.'));
      console.error('Failed to quick log interaction:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDetailedLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!logContact) return;
    setIsSaving(true);
    setAppError('');

    const interactionPayload = {
      type: interactionType,
      date: toIsoDateTime(interactionDateTime),
      notes: interactionNotes,
    };

    try {
      if (editingInteractionId) {
        await updateInteraction(editingInteractionId, interactionPayload);
      } else {
        await logInteraction({
          contact_id: logContact.id,
          ...interactionPayload,
        });
      }

      await refreshOpenContact(logContact.id);
      closeLogModal();
    } catch (err) {
      setAppError(getErrorMessage(err, 'Could not save interaction.'));
      console.error('Failed to save interaction:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInteractionEdit = (interaction: Interaction) => {
    if (!timelineContact) return;

    setLogContact(timelineContact);
    setInteractionType(interaction.type);
    setInteractionNotes(interaction.notes || '');
    setInteractionDateTime(formatDateTimeInputValue(interaction.date));
    setEditingInteractionId(interaction.id);
    setTimelineContact(null);
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag],
    );
  };

  return (
    <div className="meal-app-shell">
      <main className="meal-app-inner">
        <header className="meal-topbar">
          <div className="meal-brand">
            <div className="meal-brand-mark">LG</div>
            <div>
              <h1>Relationship Board</h1>
              <p>Stay close with the people who matter.</p>
            </div>
          </div>
          <button
            type="button"
            className="meal-btn meal-btn-primary"
            onClick={() => {
              if (showAddForm) {
                closeContactForm();
                return;
              }

              resetForm();
              setShowAddForm(true);
            }}
          >
            {showAddForm ? <X size={18} /> : <UserPlus size={18} />}
            {showAddForm ? 'Close' : 'Add contact'}
          </button>
        </header>

        {appError && (
          <div className="meal-alert error">
            <span>{appError}</span>
            <button type="button" onClick={() => setAppError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}

        <section className="meal-board">
          {contactColumns.map((column) => (
            <div key={column.key} className="meal-column">
              <div className="meal-column-title">
                <span>{column.title}</span>
                <span className={column.countClass}>{column.contacts.length}</span>
              </div>

              {column.contacts.length > 0 ? (
                column.contacts.map((contact) => (
                  <article key={contact.id} className={`meal-card ${getContactStatus(contact)}`}>
                    <div className="meal-person-row">
                      <div className={`meal-avatar ${getContactStatus(contact)}`}>{getInitials(contact)}</div>
                      <div>
                        <h3>{getContactName(contact)}</h3>
                        <p>{getStatusText(contact)}</p>
                      </div>
                    </div>

                    <div className="meal-last-touch">
                      <span>Last touch</span>
                      <p>{getLastTouch(contact)}</p>
                    </div>

                    <div className="meal-chip-list">
                      {splitTags(contact.tags).map((tag) => (
                        <span key={tag} className="meal-chip">{tag}</span>
                      ))}
                    </div>

                    <div className="meal-meta-row">
                      <span>{contact.preferred_contact_method || 'Texting'}</span>
                      <span>{contact.preferred_meeting_method || 'In-person'}</span>
                      {contact.birthday && <span>{formatShortDate(contact.birthday)}</span>}
                    </div>

                    <div className="meal-card-actions">
                      <button
                        type="button"
                        className="meal-btn meal-btn-green"
                        onClick={() => openLogModal(contact)}
                      >
                        Log interaction
                      </button>
                      <button
                        type="button"
                        className="meal-btn meal-btn-secondary"
                        onClick={() => openTimeline(contact)}
                      >
                        Timeline
                      </button>
                      <button
                        type="button"
                        className="meal-btn meal-btn-secondary"
                        onClick={() => handleEditContact(contact)}
                      >
                        <Edit2 size={16} />
                        Edit contact
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="meal-empty-column">No contacts here.</div>
              )}
            </div>
          ))}
        </section>

        {contacts.length === 0 && (
          <div className="meal-empty-state">
            <UserPlus size={28} />
            <h2>No contacts yet</h2>
            <button type="button" className="meal-btn meal-btn-primary" onClick={() => {
              resetForm();
              setShowAddForm(true);
            }}>
              Add your first contact
            </button>
          </div>
        )}
      </main>

      {showAddForm && (
        <div className="meal-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeContactForm()}>
          <form onSubmit={handleAdd} className="meal-form-panel" role="dialog" aria-modal="true" aria-labelledby="contact-form-title">
            <div className="meal-section-head">
              <div>
                <p className="meal-label">{isEditing ? 'Edit contact' : 'New contact'}</p>
                <h2 id="contact-form-title">{isEditing ? getContactName({ first_name: firstName, last_name: lastName } as Contact) || 'Edit contact' : 'Add someone'}</h2>
              </div>
              <button type="button" className="meal-icon-button" onClick={closeContactForm} aria-label="Close contact form">
                <X size={18} />
              </button>
            </div>

            <div className="meal-form-grid">
              <label className="meal-field">
                <span>First name</span>
                <input value={firstName} onChange={(event) => setFirstName(event.target.value)} required />
              </label>
              <label className="meal-field">
                <span>Last name</span>
                <input value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </label>
              <label className="meal-field">
                <span>Birthday</span>
                <input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
              </label>
              <label className="meal-field">
                <span>Contact every</span>
                <input type="number" value={newFreq} onChange={(event) => setNewFreq(Number(event.target.value))} />
              </label>
              <label className="meal-field">
                <span>Preferred contact</span>
                <select value={prefContact} onChange={(event) => setPrefContact(event.target.value)}>
                  {CONTACT_METHODS.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </label>
              <label className="meal-field">
                <span>Preferred catch-up</span>
                <select value={prefMeeting} onChange={(event) => setPrefMeeting(event.target.value)}>
                  {CATCH_UP_METHODS.map((method) => (
                    <option key={method} value={method}>{method}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="meal-field full">
              <span>How I know them</span>
              <div className="meal-chip-list">
                {TAG_OPTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className={`meal-chip-button ${selectedTags.includes(tag) ? 'active' : ''}`}
                    onClick={() => handleTagToggle(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="meal-form-actions">
              {editingContact && (
                <button
                  type="button"
                  disabled={isSaving}
                  className="meal-btn meal-btn-danger"
                  onClick={() => handleDeleteContact(editingContact)}
                >
                  <Trash2 size={16} />
                  Delete contact
                </button>
              )}
              <button type="submit" disabled={isSaving} className="meal-btn meal-btn-primary">
                {isSaving ? 'Saving...' : isEditing ? 'Update contact' : 'Add contact'}
              </button>
              <button type="button" className="meal-btn meal-btn-secondary" onClick={closeContactForm}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {logContact && (
        <div className="meal-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeLogModal()}>
          <section className="meal-log-modal" role="dialog" aria-modal="true" aria-labelledby="log-title">
            <div className="meal-modal-head">
              <div>
                <p className="meal-label">{editingInteractionId ? 'Edit interaction' : 'Log interaction'}</p>
                <h2 id="log-title">{getContactName(logContact)}</h2>
              </div>
              <button type="button" className="meal-icon-button" onClick={closeLogModal} aria-label="Close log form">
                <X size={18} />
              </button>
            </div>

            {!editingInteractionId && (
              <div className="meal-quick-log">
                <div>
                  <strong>Quick log</strong>
                  <p>Records today with no extra notes.</p>
                </div>
                <button type="button" className="meal-btn meal-btn-green" disabled={isSaving} onClick={handleQuickLog}>
                  <CheckCircle size={17} />
                  Quick log now
                </button>
              </div>
            )}

            <form onSubmit={handleDetailedLog} className="meal-modal-form">
              <div className="meal-form-grid compact">
                <label className="meal-field">
                  <span>Type</span>
                  <select value={interactionType} onChange={(event) => setInteractionType(event.target.value)}>
                    <option value="Meeting">Meeting</option>
                    <option value="Call">Call</option>
                    <option value="Message">Message</option>
                    <option value="Other">Other</option>
                  </select>
                </label>
                <label className="meal-field">
                  <span>When</span>
                  <input
                    type="datetime-local"
                    value={interactionDateTime}
                    onChange={(event) => setInteractionDateTime(event.target.value)}
                  />
                </label>
              </div>
              <label className="meal-field">
                <span>Notes</span>
                <textarea
                  placeholder="What did you talk about?"
                  value={interactionNotes}
                  onChange={(event) => setInteractionNotes(event.target.value)}
                />
              </label>
              <div className="meal-form-actions">
                <button type="submit" disabled={isSaving} className="meal-btn meal-btn-primary">
                  {isSaving ? 'Saving...' : editingInteractionId ? 'Update interaction' : 'Save with notes'}
                </button>
                <button type="button" className="meal-btn meal-btn-secondary" onClick={closeLogModal}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {timelineContact && (
        <div className="meal-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setTimelineContact(null)}>
          <aside className="meal-timeline-drawer" role="dialog" aria-modal="true" aria-labelledby="timeline-title">
            <div className="meal-modal-head">
              <div>
                <p className="meal-label">Interaction history</p>
                <h2 id="timeline-title">{getContactName(timelineContact)}</h2>
              </div>
              <button type="button" className="meal-icon-button" onClick={() => setTimelineContact(null)} aria-label="Close timeline">
                <X size={18} />
              </button>
            </div>

            <div className="meal-timeline-profile">
              <div className={`meal-avatar ${getContactStatus(timelineContact)}`}>{getInitials(timelineContact)}</div>
              <div>
                <div className="meal-chip-list">
                  {splitTags(timelineContact.tags).map((tag) => (
                    <span key={tag} className="meal-chip">{tag}</span>
                  ))}
                </div>
                <p>{timelineContact.preferred_contact_method} · {timelineContact.preferred_meeting_method} · every {timelineContact.frequency_days} days</p>
              </div>
            </div>

            <button type="button" className="meal-btn meal-btn-green" onClick={() => {
              setTimelineContact(null);
              openLogModal(timelineContact);
            }}>
              Log interaction
            </button>

            <div className="meal-timeline-list">
              {timelineContact.interactions && timelineContact.interactions.length > 0 ? (
                timelineContact.interactions.map((interaction) => (
                  <article key={interaction.id} className="meal-timeline-item">
                    <div>
                      <span className="meal-timeline-type">{interaction.type}</span>
                      <h3>{formatFullDateTime(interaction.date)}</h3>
                    </div>
                    {interaction.notes ? <p>{interaction.notes}</p> : <p>No notes added.</p>}
                    <button
                      type="button"
                      className="meal-btn meal-btn-secondary"
                      onClick={() => handleInteractionEdit(interaction)}
                    >
                      Edit interaction
                    </button>
                  </article>
                ))
              ) : (
                <div className="meal-empty-column">No interactions yet.</div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
};

export default App;
