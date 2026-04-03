import axios from 'axios';

const API_URL = '/api';

// Create an axios instance with withCredentials enabled
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true
});

export const getContacts = () => api.get('/contacts');
export const getContactDetails = (id: number) => api.get(`/contacts/${id}`);
export const addContact = (contact: { 
  first_name: string; 
  last_name?: string; 
  email?: string; 
  birthday?: string;
  frequency_days: number; 
  tags?: string[]; 
  preferred_contact_method?: string; 
  preferred_meeting_method?: string; 
}) => api.post('/contacts', contact);

export const updateContact = (id: number, contact: { 
  first_name: string; 
  last_name?: string; 
  email?: string; 
  birthday?: string;
  frequency_days: number; 
  tags?: string[]; 
  preferred_contact_method?: string; 
  preferred_meeting_method?: string; 
}) => api.put(`/contacts/${id}`, contact);

export const deleteContact = (id: number) => api.delete(`/contacts/${id}`);
export const logInteraction = (interaction: { contact_id: number; type: string; date: string; notes?: string }) => 
  api.post('/interactions', interaction);

export const login = (password: string) => api.post('/login', { password });
export const logout = () => api.post('/logout');
export const checkAuth = () => api.get('/auth-check');
