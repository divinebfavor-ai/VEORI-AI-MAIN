import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' }
})

// Request interceptor — attach token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('veori_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor — handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('veori_token')
      localStorage.removeItem('veori_user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// ─── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login: (email, password) => api.post('/api/auth/login', { email, password }),
  register: (data) => api.post('/api/auth/register', data),
  getMe: () => api.get('/api/auth/me'),
  logout: () => api.post('/api/auth/logout'),
}

// ─── Leads ───────────────────────────────────────────────────────────────────
export const leads = {
  getLeads: (params) => api.get('/api/leads', { params }),
  getLead: (id) => api.get(`/api/leads/${id}`),
  createLead: (data) => api.post('/api/leads', data),
  bulkImportLeads: (leadsData) => api.post('/api/leads/bulk', { leads: leadsData }),
  updateLead: (id, data) => api.put(`/api/leads/${id}`, data),
  deleteLead: (id) => api.delete(`/api/leads/${id}`),
  getLeadResearch: (id) => api.get(`/api/leads/${id}/research`),
  addToDNC: (id, reason) => api.post(`/api/leads/${id}/dnc`, { reason }),
}

// ─── Calls ────────────────────────────────────────────────────────────────────
export const calls = {
  getCalls: (params) => api.get('/api/calls', { params }),
  getCall: (id) => api.get(`/api/calls/${id}`),
  getLiveCalls: () => api.get('/api/calls/live'),
  initiateCall: (data) => api.post('/api/calls/initiate', data),
  campaignStart: (campaignId) => api.post(`/api/calls/campaign/${campaignId}/start`),
  campaignPause: (campaignId) => api.post(`/api/calls/campaign/${campaignId}/pause`),
  campaignStop: (campaignId) => api.post(`/api/calls/campaign/${campaignId}/stop`),
  callTakeover: (callId) => api.post(`/api/calls/${callId}/takeover`),
  returnToAI: (callId) => api.post(`/api/calls/${callId}/return-to-ai`),
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
export const campaigns = {
  getCampaigns: () => api.get('/api/campaigns'),
  getCampaign: (id) => api.get(`/api/campaigns/${id}`),
  getCampaignStats: (id) => api.get(`/api/campaigns/${id}/stats`),
  createCampaign: (data) => api.post('/api/campaigns', data),
  updateCampaign: (id, data) => api.put(`/api/campaigns/${id}`, data),
  startCampaign: (id) => api.post(`/api/campaigns/${id}/start`),
  pauseCampaign: (id) => api.post(`/api/campaigns/${id}/pause`),
  stopCampaign: (id) => api.post(`/api/campaigns/${id}/stop`),
}

// ─── Phones ──────────────────────────────────────────────────────────────────
export const phones = {
  getPhones: () => api.get('/api/phones'),
  getPhoneHealth: () => api.get('/api/phones/health'),
  addPhone: (data) => api.post('/api/phones', data),
  updatePhone: (id, data) => api.put(`/api/phones/${id}`, data),
  deletePhone: (id) => api.delete(`/api/phones/${id}`),
  bulkAddPhones: (numbers) => api.post('/api/phones/bulk', { numbers }),
}

// ─── Deals ───────────────────────────────────────────────────────────────────
export const deals = {
  getDeals: (params) => api.get('/api/deals', { params }),
  getDeal: (id) => api.get(`/api/deals/${id}`),
  createDeal: (data) => api.post('/api/deals', data),
  updateDeal: (id, data) => api.put(`/api/deals/${id}`, data),
  generateContract: (id, type) => api.post(`/api/deals/${id}/contract/${type}`),
  sendContract: (id, type, data) => api.post(`/api/deals/${id}/contract/${type}/send`, data),
  startBuyerCampaign: (id) => api.post(`/api/deals/${id}/buyer-campaign`),
}

// ─── Buyers ──────────────────────────────────────────────────────────────────
export const buyers = {
  getBuyers: (params) => api.get('/api/buyers', { params }),
  getBuyer: (id) => api.get(`/api/buyers/${id}`),
  createBuyer: (data) => api.post('/api/buyers', data),
  bulkAddBuyers: (buyersData) => api.post('/api/buyers/bulk', { buyers: buyersData }),
  updateBuyer: (id, data) => api.put(`/api/buyers/${id}`, data),
  deleteBuyer: (id) => api.delete(`/api/buyers/${id}`),
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analytics = {
  getDashboard: () => api.get('/api/analytics/dashboard'),
  getCallAnalytics: (days) => api.get('/api/analytics/calls', { params: { days } }),
  getRevenue: () => api.get('/api/analytics/revenue'),
}

// ─── AI ──────────────────────────────────────────────────────────────────────
export const ai = {
  sendAssistantMessage: (message, history) =>
    api.post('/api/vapi/assistant', { message, history }),
  sendAriaMessage: (message, history) =>
    api.post('/api/aria/chat', { message, history }),
}

export default api
