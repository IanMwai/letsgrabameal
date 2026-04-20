import React, { useState, useEffect } from 'react';
import { getContacts, logInteraction, addContact, deleteContact, getContactDetails, updateContact, updateInteraction, login, logout, checkAuth } from './api';

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
  interactions?: Interaction[];
}

type IconProps = {
  size?: number;
  className?: string;
};

const SvgIcon: React.FC<React.PropsWithChildren<IconProps>> = ({
  size = 24,
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

const Clock: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
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

const ChevronRight: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="m9 18 6-6-6-6" />
  </SvgIcon>
);

const Phone: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8l-1.3 1.3a16 16 0 0 0 6.4 6.4l1.3-1.3a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 2Z" />
  </SvgIcon>
);

const MessageSquare: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M21 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3Z" />
  </SvgIcon>
);

const MapPin: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 21s7-4.4 7-11a7 7 0 1 0-14 0c0 6.6 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.5" />
  </SvgIcon>
);

const Tag: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M20 12 12 20l-9-9V4h7Z" />
    <circle cx="7.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
  </SvgIcon>
);

const Gift: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M20 12v8H4v-8" />
    <path d="M2 7h20v5H2z" />
    <path d="M12 7v13" />
    <path d="M12 7H7.5A2.5 2.5 0 1 1 10 4.5L12 7Z" />
    <path d="M12 7h4.5A2.5 2.5 0 1 0 14 4.5L12 7Z" />
  </SvgIcon>
);

const Edit2: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M12 20h9" />
    <path d="m16.5 3.5 4 4L8 20l-5 1 1-5Z" />
  </SvgIcon>
);

const Lock: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 1 1 8 0v3" />
  </SvgIcon>
);

const LogOut: React.FC<IconProps> = (props) => (
  <SvgIcon {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
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

  if (diffMinutes < 1) return 'less than a minute';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'}`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'}`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'}`;

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} year${diffYears === 1 ? '' : 's'}`;
};

const getLocalMonthDay = (value: string) => {
  const dateOnlyMatch = value.match(/^\d{4}-(\d{2})-(\d{2})$/);

  if (dateOnlyMatch) {
    return `${dateOnlyMatch[1]}-${dateOnlyMatch[2]}`;
  }

  const parsedDate = parseAppDate(value);
  return `${String(parsedDate.getMonth() + 1).padStart(2, '0')}-${String(parsedDate.getDate()).padStart(2, '0')}`;
};

const getTodayLocalMonthDay = () => {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const splitTags = (value: string | null | undefined) =>
  value
    ? value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

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
  
  const TAG_OPTIONS = ['Family', 'Harvard', 'LinkedIn connection', 'Home', 'KU', 'Church', 'Conferences', 'Other'];
  const CONTACT_METHODS = ['Texting', 'Calling', 'Emailing', 'Message (WhatsApp/Telegram)', 'Other'];
  const CATCH_UP_METHODS = ['In-person', 'Texting', 'Video Call', 'Voice Call', 'Other'];

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [interactionNotes, setInteractionNotes] = useState('');
  const [interactionType, setInteractionType] = useState('Meeting');
  const [interactionDateTime, setInteractionDateTime] = useState(getNowDateTimeInputValue());
  const [editingInteractionId, setEditingInteractionId] = useState<number | null>(null);
  const [overdueCount, setOverdueCount] = useState(0);
  const [birthdayContacts, setBirthdayContacts] = useState<Contact[]>([]);

  const fetchContacts = async () => {
    try {
      const res = await getContacts();
      setContacts(res.data);
      
      const overdue = res.data.filter((c: Contact) => (c.days_since_contact || 0) >= c.frequency_days);
      setOverdueCount(overdue.length);

      const today = getTodayLocalMonthDay();
      const bdays = res.data.filter((c: Contact) => c.birthday && getLocalMonthDay(c.birthday) === today);
      setBirthdayContacts(bdays);
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  const checkInitialAuth = async () => {
    try {
      const res = await checkAuth();
      setIsAuthenticated(res.data.authenticated);
      if (res.data.authenticated) {
        fetchContacts();
      }
    } catch (err) {
      setIsAuthenticated(false);
    }
  };

  useEffect(() => {
    checkInitialAuth();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      await login(loginPassword);
      setIsAuthenticated(true);
      fetchContacts();
    } catch (err) {
      setLoginError('Invalid password. Please try again.');
    }
  };

  const handleLogout = async () => {
    await logout();
    setIsAuthenticated(false);
    setContacts([]);
    setLoginPassword('');
    setSelectedContact(null);
    setInteractionType('Meeting');
    setInteractionNotes('');
    setInteractionDateTime(getNowDateTimeInputValue());
    setEditingInteractionId(null);
  };

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

  const resetInteractionForm = () => {
    setInteractionType('Meeting');
    setInteractionNotes('');
    setInteractionDateTime(getNowDateTimeInputValue());
    setEditingInteractionId(null);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const contactData = { 
      first_name: firstName, 
      last_name: lastName, 
      birthday,
      frequency_days: newFreq, 
      tags: selectedTags,
      preferred_contact_method: prefContact,
      preferred_meeting_method: prefMeeting
    };

    if (isEditing && editingId) {
      await updateContact(editingId, contactData);
    } else {
      await addContact(contactData);
    }
    
    resetForm();
    setShowAddForm(false);
    fetchContacts();
  };

  const handleEdit = (contact: Contact, e: React.MouseEvent) => {
    e.stopPropagation();
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleQuickLog = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    await logInteraction({
      contact_id: id,
      type: 'Meeting',
      date: new Date().toISOString(),
      notes: 'Quick log from dashboard'
    });
    fetchContacts();
    if (selectedContact?.id === id) {
      loadContactDetails(id);
    }
  };

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure?')) {
      await deleteContact(id);
      fetchContacts();
      if (selectedContact?.id === id) setSelectedContact(null);
    }
  };

  const loadContactDetails = async (id: number) => {
    const res = await getContactDetails(id);
    setSelectedContact(res.data);
    resetInteractionForm();
  };

  const handleDetailedLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) return;

    const interactionPayload = {
      type: interactionType,
      date: toIsoDateTime(interactionDateTime),
      notes: interactionNotes,
    };

    if (editingInteractionId) {
      await updateInteraction(editingInteractionId, interactionPayload);
    } else {
      await logInteraction({
        contact_id: selectedContact.id,
        ...interactionPayload,
      });
    }

    resetInteractionForm();
    loadContactDetails(selectedContact.id);
    fetchContacts();
  };

  const handleInteractionEdit = (interaction: Interaction) => {
    setInteractionType(interaction.type);
    setInteractionNotes(interaction.notes || '');
    setInteractionDateTime(formatDateTimeInputValue(interaction.date));
    setEditingInteractionId(interaction.id);
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const getUrgencyColor = (contact: Contact) => {
    const daysSince = contact.days_since_contact || 0;
    const frequency = contact.frequency_days;
    
    if (daysSince >= frequency) return 'border-red-500 bg-red-50';
    const remainingRatio = (frequency - daysSince) / frequency;
    if (remainingRatio <= 0.1) return 'border-amber-500 bg-amber-50';
    
    return 'border-emerald-500 bg-emerald-50';
  };

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (isAuthenticated === false) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-[2rem] shadow-2xl p-10 border border-slate-100">
          <div className="text-center mb-10">
            <div className="w-20 h-20 bg-indigo-100 rounded-3xl flex items-center justify-center mx-auto mb-6 text-indigo-600 shadow-inner">
              <Lock size={40} />
            </div>
            <h1 className="text-3xl font-black text-slate-900 mb-2 tracking-tight">Private Access</h1>
            <p className="text-slate-500">Please enter your password to access your contacts.</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-700 ml-1 uppercase tracking-wider">Secret Password</label>
              <input
                type="password"
                placeholder="••••••••"
                className="w-full p-4 border border-slate-200 rounded-2xl bg-slate-50 focus:bg-white focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 outline-none transition-all text-center text-xl tracking-widest"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                autoFocus
              />
              {loginError && <p className="text-red-500 text-sm font-bold text-center mt-2">{loginError}</p>}
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white font-black py-4 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg">Unlock Dashboard</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto flex flex-col md:flex-row gap-8 bg-slate-50">
      <div className="flex-1">
        {birthdayContacts.length > 0 && (
          <div className="mb-6 p-4 bg-pink-100 border border-pink-200 text-pink-700 rounded-2xl flex items-center gap-3 animate-bounce">
            <Gift size={20} /> <span className="font-bold">It's {birthdayContacts.map(c => c.first_name).join(', ')}'s birthday today! 🎂</span>
          </div>
        )}
        {overdueCount > 0 && (
          <div className="mb-6 p-4 bg-red-100 border border-red-200 text-red-700 rounded-2xl flex items-center gap-3 animate-pulse">
            <Clock size={20} /> <span className="font-bold">You have {overdueCount} contact{overdueCount > 1 ? 's' : ''} overdue for a meal!</span>
          </div>
        )}
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Let's Grab a Meal</h1>
            <p className="text-slate-500 mt-1">Stay close with the people who matter.</p>
          </div>
          <div className="flex gap-3">
            <button onClick={handleLogout} className="p-3 text-slate-400 hover:text-red-500 transition-all rounded-full hover:bg-red-50" title="Logout"><LogOut size={24} /></button>
            <button onClick={() => { if (showAddForm) resetForm(); setShowAddForm(!showAddForm); }} className="bg-indigo-600 text-white p-3 rounded-full hover:bg-indigo-700 transition-all shadow-lg hover:scale-105 active:scale-95">
              {showAddForm ? <X size={24} /> : <UserPlus size={24} />}
            </button>
          </div>
        </header>

        {showAddForm && (
          <form onSubmit={handleAdd} className="mb-8 p-6 bg-white rounded-3xl shadow-xl border border-slate-100 animate-in fade-in slide-in-from-top-4 duration-300">
            <h2 className="text-2xl font-bold text-slate-800 mb-6">{isEditing ? 'Edit Contact' : 'Add Someone New'}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">First Name</label>
                <input type="text" placeholder="First Name" className="w-full p-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Last Name</label>
                <input type="text" placeholder="Last Name" className="w-full p-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Birthday</label>
                <input type="date" className="w-full p-3 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none" value={birthday} onChange={(e) => setBirthday(e.target.value)} />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-semibold text-slate-700">How I know them</label>
                <div className="flex flex-wrap gap-2">
                  {TAG_OPTIONS.map(tag => (
                    <button key={tag} type="button" onClick={() => handleTagToggle(tag)} className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${selectedTags.includes(tag) ? 'bg-indigo-100 border-indigo-300 text-indigo-700 shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{tag}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Preferred Contact Method</label>
                <select value={prefContact} onChange={(e) => setPrefContact(e.target.value)} className="w-full p-3 border border-slate-200 rounded-2xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
                  {CONTACT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">Preferred Catch-Up Method</label>
                <select value={prefMeeting} onChange={(e) => setPrefMeeting(e.target.value)} className="w-full p-3 border border-slate-200 rounded-2xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
                  {CATCH_UP_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-3 md:col-span-2 pt-2">
                <span className="text-sm font-semibold text-slate-700">Goal: Contact every</span>
                <input type="number" className="p-3 border border-slate-200 rounded-2xl w-24 text-center focus:ring-2 focus:ring-indigo-500 outline-none" value={newFreq} onChange={(e) => setNewFreq(parseInt(e.target.value))} />
                <span className="text-sm font-semibold text-slate-700">days</span>
              </div>
            </div>
            <div className="mt-8 flex gap-3">
              <button type="submit" className="flex-1 bg-indigo-600 text-white font-bold py-3 rounded-2xl hover:bg-indigo-700 transition-all shadow-md">{isEditing ? 'Update Contact' : 'Add Contact'}</button>
              <button type="button" onClick={() => { resetForm(); setShowAddForm(false); }} className="px-8 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-all">Cancel</button>
            </div>
          </form>
        )}

        <div className="grid gap-6">
          {contacts.map((contact) => (
            <div key={contact.id} onClick={() => loadContactDetails(contact.id)} className={`p-6 rounded-3xl border-l-[12px] shadow-sm hover:shadow-xl transition-all cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-white transform hover:-translate-y-1 ${getUrgencyColor(contact)} ${selectedContact?.id === contact.id ? 'ring-4 ring-indigo-200' : ''}`}>
              <div className="flex-1">
                <div className="flex items-center flex-wrap gap-2 mb-2">
                  <h3 className="text-2xl font-bold text-slate-800">{contact.first_name} {contact.last_name}</h3>
                  {splitTags(contact.tags).map(tag => (
                    <span key={tag} className="text-[10px] font-bold uppercase bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full border border-indigo-100">{tag}</span>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><Clock size={16} className="text-slate-400" /><span>Every {contact.frequency_days} days</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><CheckCircle size={16} className="text-slate-400" /><span>{contact.last_contact_date ? `${formatRelativeTime(contact.last_contact_date)} ago` : 'Never contacted'}</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><MessageSquare size={16} className="text-slate-400" /><span>Via: {contact.preferred_contact_method}</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><MapPin size={16} className="text-slate-400" /><span>Catch up: {contact.preferred_meeting_method}</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><Gift size={16} className="text-slate-400" /><span>{contact.birthday ? formatShortDate(contact.birthday) : 'No birthday'}</span></div>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto">
                <button onClick={(e) => handleQuickLog(contact.id, e)} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white px-6 py-3 rounded-2xl hover:bg-indigo-700 transition-all font-bold shadow-md">Quick Log</button>
                <div className="flex gap-1">
                  <button onClick={(e) => handleEdit(contact, e)} className="p-3 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-2xl transition-all" title="Edit Contact"><Edit2 size={22} /></button>
                  <button onClick={(e) => handleDelete(contact.id, e)} className="p-3 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all" title="Delete Contact"><Trash2 size={22} /></button>
                  <div className="flex items-center p-3 text-slate-300"><ChevronRight size={22} /></div>
                </div>
              </div>
            </div>
          ))}
          {contacts.length === 0 && (
            <div className="text-center py-24 bg-white rounded-[2rem] border-2 border-dashed border-slate-200 shadow-inner">
              <UserPlus size={32} className="text-slate-300 mx-auto mb-6" />
              <p className="text-slate-500 text-xl font-bold">No contacts yet</p>
              <button onClick={() => setShowAddForm(true)} className="mt-8 bg-indigo-600 text-white px-8 py-3 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg">Add Your First Contact</button>
            </div>
          )}
        </div>
      </div>

      {selectedContact && (
        <div className="w-full md:w-[400px] bg-white border border-slate-100 rounded-[2rem] shadow-2xl p-8 h-fit sticky top-8 animate-in slide-in-from-right-8 duration-500">
          <div className="flex justify-between items-start mb-8">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 font-bold text-2xl">{selectedContact.first_name[0]}{selectedContact.last_name?.[0] || ''}</div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900 leading-tight">{selectedContact.first_name} {selectedContact.last_name}</h2>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">How I know them</p>
                <div className="flex flex-wrap gap-2">
                {splitTags(selectedContact.tags).map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-[11px] font-bold bg-slate-50 text-slate-500 px-3 py-1 rounded-full border border-slate-100"><Tag size={10} />{tag}</span>
                ))}
                {splitTags(selectedContact.tags).length === 0 && (
                  <span className="text-sm text-slate-400">No context added yet.</span>
                )}
                </div>
              </div>
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone size={16} className="text-slate-400" />
                  <span>Reach out via {selectedContact.preferred_contact_method}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <MapPin size={16} className="text-slate-400" />
                  <span>Catch up via {selectedContact.preferred_meeting_method}</span>
                </div>
              </div>
            </div>
            <button onClick={() => setSelectedContact(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><X size={24} /></button>
          </div>

          <form onSubmit={handleDetailedLog} className="mb-8 p-6 bg-slate-50 rounded-[1.5rem] border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><CheckCircle size={18} className="text-indigo-500" />{editingInteractionId ? 'Edit Interaction' : 'Log Interaction'}</h3>
            <select value={interactionType} onChange={(e) => setInteractionType(e.target.value)} className="w-full p-3 mb-3 border border-slate-200 rounded-xl bg-white outline-none font-medium">
              <option value="Meeting">Meeting</option><option value="Call">Call</option><option value="Message">Message</option><option value="Other">Other</option>
            </select>
            <input type="datetime-local" value={interactionDateTime} onChange={(e) => setInteractionDateTime(e.target.value)} className="w-full p-3 mb-3 border border-slate-200 rounded-xl bg-white outline-none font-medium" />
            <textarea placeholder="What did you talk about?" value={interactionNotes} onChange={(e) => setInteractionNotes(e.target.value)} className="w-full p-4 border border-slate-200 rounded-xl bg-white mb-4 outline-none min-h-[100px]" />
            <div className="flex gap-3">
              <button type="submit" className="flex-1 bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg">{editingInteractionId ? 'Update Interaction' : 'Save Interaction'}</button>
              {editingInteractionId && (
                <button type="button" onClick={resetInteractionForm} className="px-4 py-3 rounded-xl font-bold bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 transition-all">Cancel</button>
              )}
            </div>
          </form>

          <div>
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><Clock size={18} className="text-indigo-500" />Interaction History</h3>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {selectedContact.interactions && selectedContact.interactions.length > 0 ? (
                selectedContact.interactions.map(interaction => (
                  <div key={interaction.id} className="p-4 border border-slate-50 rounded-2xl bg-white shadow-sm">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[11px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{interaction.type}</span>
                      <button type="button" onClick={() => handleInteractionEdit(interaction)} className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 transition-all">Edit</button>
                    </div>
                    <p className="text-[11px] font-bold text-slate-400 mb-2">{formatFullDateTime(interaction.date)}</p>
                    {interaction.notes && <p className="text-sm text-slate-600 leading-relaxed">{interaction.notes}</p>}
                  </div>
                ))
              ) : (<p className="text-center text-slate-400 py-8 uppercase text-xs font-bold tracking-widest">No interactions yet</p>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
