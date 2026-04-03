import React, { useState, useEffect } from 'react';
import { getContacts, logInteraction, addContact, deleteContact, getContactDetails, updateContact, login, logout, checkAuth } from './api';
import { UserPlus, Trash2, Clock, CheckCircle, X, ChevronRight, Phone, MessageSquare, MapPin, Tag, Gift, Edit2, Lock, LogOut } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';

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
  
  const TAG_OPTIONS = ['Harvard', 'LinkedIn connection', 'Home', 'KU', 'Church', 'Conferences', 'Other'];
  const CONTACT_METHODS = ['Texting', 'Calling', 'Emailing', 'Message (WhatsApp/Telegram)', 'Other'];
  const MEETING_METHODS = ['In-person', 'Video Call', 'Voice Call', 'Other'];

  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [interactionNotes, setInteractionNotes] = useState('');
  const [interactionType, setInteractionType] = useState('Meeting');
  const [overdueCount, setOverdueCount] = useState(0);
  const [birthdayContacts, setBirthdayContacts] = useState<Contact[]>([]);

  const fetchContacts = async () => {
    try {
      const res = await getContacts();
      setContacts(res.data);
      
      const overdue = res.data.filter((c: Contact) => (c.days_since_contact || 0) >= c.frequency_days);
      setOverdueCount(overdue.length);

      const today = new Date().toISOString().slice(5, 10);
      const bdays = res.data.filter((c: Contact) => c.birthday && c.birthday.slice(5, 10) === today);
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
    setSelectedTags(contact.tags ? contact.tags.split(',') : []);
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
  };

  const handleDetailedLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedContact) return;
    await logInteraction({
      contact_id: selectedContact.id,
      type: interactionType,
      date: new Date().toISOString(),
      notes: interactionNotes
    });
    setInteractionNotes('');
    loadContactDetails(selectedContact.id);
    fetchContacts();
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
                <label className="text-sm font-semibold text-slate-700">Tags</label>
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
                <label className="text-sm font-semibold text-slate-700">Preferred Meeting Method</label>
                <select value={prefMeeting} onChange={(e) => setPrefMeeting(e.target.value)} className="w-full p-3 border border-slate-200 rounded-2xl bg-white focus:ring-2 focus:ring-indigo-500 outline-none">
                  {MEETING_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
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
                  {contact.tags && contact.tags.split(',').map(tag => (
                    <span key={tag} className="text-[10px] font-bold uppercase bg-indigo-50 text-indigo-500 px-2 py-0.5 rounded-full border border-indigo-100">{tag}</span>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><Clock size={16} className="text-slate-400" /><span>Every {contact.frequency_days} days</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><CheckCircle size={16} className="text-slate-400" /><span>{contact.last_contact_date ? `${formatDistanceToNow(new Date(contact.last_contact_date))} ago` : 'Never contacted'}</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><MessageSquare size={16} className="text-slate-400" /><span>Via: {contact.preferred_contact_method}</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><MapPin size={16} className="text-slate-400" /><span>Meet: {contact.preferred_meeting_method}</span></div>
                  <div className="flex items-center gap-2 text-slate-500 text-sm"><Gift size={16} className="text-slate-400" /><span>{contact.birthday ? format(new Date(contact.birthday), 'MMM d') : 'No birthday'}</span></div>
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
              <div className="flex flex-wrap gap-2 mt-4">
                {selectedContact.tags && selectedContact.tags.split(',').map(tag => (
                  <span key={tag} className="flex items-center gap-1 text-[11px] font-bold bg-slate-50 text-slate-500 px-3 py-1 rounded-full border border-slate-100"><Tag size={10} />{tag}</span>
                ))}
              </div>
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <Phone size={16} className="text-slate-400" />
                  <span>{selectedContact.preferred_contact_method}</span>
                </div>
              </div>
            </div>
            <button onClick={() => setSelectedContact(null)} className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-full transition-all"><X size={24} /></button>
          </div>

          <form onSubmit={handleDetailedLog} className="mb-8 p-6 bg-slate-50 rounded-[1.5rem] border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><CheckCircle size={18} className="text-indigo-500" />Log Interaction</h3>
            <select value={interactionType} onChange={(e) => setInteractionType(e.target.value)} className="w-full p-3 mb-3 border border-slate-200 rounded-xl bg-white outline-none font-medium">
              <option value="Meeting">Meeting</option><option value="Call">Call</option><option value="Message">Message</option><option value="Other">Other</option>
            </select>
            <textarea placeholder="What did you talk about?" value={interactionNotes} onChange={(e) => setInteractionNotes(e.target.value)} className="w-full p-4 border border-slate-200 rounded-xl bg-white mb-4 outline-none min-h-[100px]" />
            <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg">Save Interaction</button>
          </form>

          <div>
            <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2"><Clock size={18} className="text-indigo-500" />Recent History</h3>
            <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {selectedContact.interactions && selectedContact.interactions.length > 0 ? (
                selectedContact.interactions.map(interaction => (
                  <div key={interaction.id} className="p-4 border border-slate-50 rounded-2xl bg-white shadow-sm">
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-[11px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{interaction.type}</span>
                      <span className="text-[11px] font-bold text-slate-400">{format(new Date(interaction.date), 'MMM d, yyyy')}</span>
                    </div>
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
