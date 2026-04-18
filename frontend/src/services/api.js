import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

// Request interceptor — attach token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('veori_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor — handle 401
// Instead of window.location (full page reload), we update the Zustand store
// directly so React Router handles the redirect cleanly.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Lazy-import to avoid circular deps at module load time
      import('../store/authStore').then(({ default: useAuthStore }) => {
        useAuthStore.getState().clearAuth()
      })
    }
    return Promise.reject(error)
  }
)

// ─── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login:    (email, password) => api.post('/api/auth/login', { email, password }),
  register: (data)            => api.post('/api/auth/register', data),
  getMe:    ()                => api.get('/api/auth/me'),
  logout:   ()                => api.post('/api/auth/logout'),
}

// ─── Leads ───────────────────────────────────────────────────────────────────
export const leads = {
  getLeads:         (params) => api.get('/api/leads', { params }),
  getLead:          (id)     => api.get(`/api/leads/${id}`),
  createLead:       (data)   => api.post('/api/leads', data),
  bulkImportLeads:  (leadsData) => api.post('/api/leads/bulk', { leads: leadsData }),
  updateLead:       (id, data)  => api.put(`/api/leads/${id}`, data),
  skipTrace:        (id)        => api.post(`/api/leads/${id}/skip-trace`),
  dropVoicemail:    (id, tmpl)  => api.post(`/api/leads/${id}/voicemail`, { template: tmpl }),
  sendDirectMail:   (id, tmpl)  => api.post(`/api/leads/${id}/direct-mail`, { template: tmpl }),
  addToDnc:         (id, reason)=> api.post(`/api/leads/${id}/dnc`, { reason }),
  deleteLead:       (id)        => api.delete(`/api/leads/${id}`),
  getLeadResearch:  (id)        => api.get(`/api/leads/${id}/research`),
  addToDNC:         (id, reason) => api.post(`/api/leads/${id}/dnc`, { reason }),
}

// ─── Calls ────────────────────────────────────────────────────────────────────
export const calls = {
  getCalls:       (params)     => api.get('/api/calls', { params }),
  getCall:        (id)         => api.get(`/api/calls/${id}`),
  getLiveCalls:   ()           => api.get('/api/calls/live'),
  getCallStats:   ()           => api.get('/api/analytics/calls'),
  initiateCall:   (data)       => api.post('/api/calls/initiate', data),
  updateCall:     (id, data)   => api.put(`/api/calls/${id}`, data),
  endCall:        (id)         => api.post(`/api/calls/${id}/end`),
  callTakeover:   (callId)     => api.post('/api/calls/takeover', { call_id: callId }),
  returnToAI:     (callId)     => api.post('/api/calls/return-to-ai', { call_id: callId }),
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
export const campaigns = {
  getCampaigns:     ()         => api.get('/api/campaigns'),
  getCampaign:      (id)       => api.get(`/api/campaigns/${id}`),
  getCampaignStats: (id)       => api.get(`/api/campaigns/${id}/stats`),
  createCampaign:   (data)     => api.post('/api/campaigns', data),
  updateCampaign:   (id, data) => api.put(`/api/campaigns/${id}`, data),
  startCampaign:    (id)       => api.post(`/api/campaigns/${id}/start`),
  pauseCampaign:    (id)       => api.post(`/api/campaigns/${id}/pause`),
  stopCampaign:     (id)       => api.post(`/api/campaigns/${id}/stop`),
}

// ─── Phones ──────────────────────────────────────────────────────────────────
export const phones = {
  getPhones:     ()         => api.get('/api/phones'),
  getPhoneHealth:()         => api.get('/api/phones/health'),
  addPhone:      (data)     => api.post('/api/phones', data),
  updatePhone:   (id, data) => api.put(`/api/phones/${id}`, data),
  deletePhone:   (id)       => api.delete(`/api/phones/${id}`),
  bulkAddPhones: (numbers)  => api.post('/api/phones/bulk', { numbers }),
}

// ─── Deals ───────────────────────────────────────────────────────────────────
export const deals = {
  getDeals:          (params)       => api.get('/api/deals', { params }),
  getDeal:           (id)           => api.get(`/api/deals/${id}`),
  createDeal:        (data)         => api.post('/api/deals', data),
  updateDeal:        (id, data)     => api.put(`/api/deals/${id}`, data),
  generateContract:  (id, type)     => api.post(`/api/deals/${id}/generate-contract`, { type }),
  sendContract:      (id, type, data) => api.post(`/api/deals/${id}/send-contract`, { type, ...data }),
  startBuyerCampaign:(id)           => api.post(`/api/deals/${id}/start-buyer-campaign`),
}

// ─── Buyers ──────────────────────────────────────────────────────────────────
export const buyers = {
  getBuyers:    (params)    => api.get('/api/buyers', { params }),
  getBuyer:     (id)        => api.get(`/api/buyers/${id}`),
  createBuyer:  (data)      => api.post('/api/buyers', data),
  bulkAddBuyers:(buyersData)=> api.post('/api/buyers/bulk', { buyers: buyersData }),
  updateBuyer:  (id, data)  => api.put(`/api/buyers/${id}`, data),
  deleteBuyer:  (id)        => api.delete(`/api/buyers/${id}`),
}

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analytics = {
  getDashboard:    () => api.get('/api/analytics/dashboard'),
  getCallAnalytics:(days) => api.get('/api/analytics/calls', { params: { days } }),
  getRevenue:      () => api.get('/api/analytics/revenue'),
}

// ─── AI ──────────────────────────────────────────────────────────────────────
export const ai = {
  sendAssistantMessage: (message, history) => api.post('/api/vapi/assistant', { message, history }),
  sendAriaMessage:      (message, history) => api.post('/api/aria/chat', { message, history }),
}

// ─── Operator profile ────────────────────────────────────────────────────────
export const operator = {
  getProfile:       ()         => api.get('/api/operator/profile'),
  updateProfile:    (data)     => api.put('/api/operator/profile', data),
  getBankAccounts:  ()         => api.get('/api/operator/bank-accounts'),
  addBankAccount:   (data)     => api.post('/api/operator/bank-accounts', data),
  deleteBankAccount:(id)       => api.delete(`/api/operator/bank-accounts/${id}`),
}

// ─── Title companies ─────────────────────────────────────────────────────────
export const titleCompanies = {
  getAll:  ()          => api.get('/api/title-companies'),
  create:  (data)      => api.post('/api/title-companies', data),
  update:  (id, data)  => api.put(`/api/title-companies/${id}`, data),
  remove:  (id)        => api.delete(`/api/title-companies/${id}`),
}

// ─── Sequences ───────────────────────────────────────────────────────────────
export const sequences = {
  getAll:  ()                         => api.get('/api/sequences'),
  enroll:  (lead_id, sequence_type)   => api.post('/api/sequences/enroll', { lead_id, sequence_type }),
  cancel:  (id)                       => api.delete(`/api/sequences/${id}`),
}

// ─── Compliance ──────────────────────────────────────────────────────────────
export const compliance = {
  getStates:    ()       => api.get('/api/compliance/states'),
  getState:     (code)   => api.get(`/api/compliance/state/${code}`),
  getDisclosure:(code)   => api.get(`/api/compliance/disclosure/${code}`),
  getTcpaLog:   (params) => api.get('/api/compliance/tcpa-log', { params }),
}

export default api
