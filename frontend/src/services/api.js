import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
})

// Request interceptor - attach token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('veori_token')
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor - handle 401 + 429 with automatic retry
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status

    // 401 - log out
    if (status === 401) {
      import('../store/authStore').then(({ default: useAuthStore }) => {
        useAuthStore.getState().clearAuth()
      })
      return Promise.reject(error)
    }

    // 429 - too many requests: wait and retry automatically (up to 3 times)
    const config = error.config
    if (status === 429 && config && !config._retryCount) {
      config._retryCount = 0
    }
    if (status === 429 && config && config._retryCount < 3) {
      config._retryCount += 1
      const delay = 1000 * config._retryCount // 1s, 2s, 3s
      await new Promise((r) => setTimeout(r, delay))
      return api(config)
    }

    return Promise.reject(error)
  }
)

// ─── Auth ────────────────────────────────────────────────────────────────────
export const auth = {
  login:          (email, password) => api.post('/api/auth/login', { email, password }),
  register:       (data)            => api.post('/api/auth/register', data),
  getMe:          ()                => api.get('/api/auth/me'),
  changePassword: (data)            => api.put('/api/auth/password', data),
  forgotPassword: (email)           => api.post('/api/auth/forgot-password', { email }),
  resetPassword:  (token, new_password) => api.post('/api/auth/reset-password', { token, new_password }),
  logout:         ()                => api.post('/api/auth/logout'),
}

// ─── Lead Photos ─────────────────────────────────────────────────────────────
export const leadPhotos = {
  getPhotos:         (leadId) => api.get(`/api/leads/${leadId}/photos`),
  sendPhotoRequest:  (leadId) => api.post(`/api/leads/${leadId}/send-photo-request`),
}

// ─── Two-Factor Authentication ────────────────────────────────────────────────
export const twoFA = {
  status:    ()                      => api.get('/api/auth/2fa/status'),
  setupTOTP: ()                      => api.post('/api/auth/2fa/setup/totp'),
  setupSMS:  (phone)                 => api.post('/api/auth/2fa/setup/sms', { phone }),
  setupEmail:()                      => api.post('/api/auth/2fa/setup/email'),
  activate:  (code)                  => api.post('/api/auth/2fa/activate', { code }),
  verify:    (temp_token, code)      => api.post('/api/auth/2fa/verify', { temp_token, code }),
  resend:    (temp_token)            => api.post('/api/auth/2fa/resend', { temp_token }),
  disable:   (password)              => api.delete('/api/auth/2fa/disable', { data: { password } }),
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
  retagLead:          (id)        => api.post(`/api/leads/${id}/retag`),
  retagAll:           ()          => api.post('/api/leads/retag-all'),
  resetStaleCallingStatus: ()     => api.post('/api/leads/reset-stale-calling'),
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
  getListenUrl:   (id)         => api.get(`/api/calls/${id}/listen`).then(r => r.data),
  syncFromVapi:   ()           => api.post('/api/vapi/sync-calls'),
  deleteCall:     (id)         => api.delete(`/api/calls/${id}`),
}

// ─── Campaigns ────────────────────────────────────────────────────────────────
export const campaigns = {
  getCampaigns:     ()         => api.get('/api/campaigns'),
  getCampaign:      (id)       => api.get(`/api/campaigns/${id}`),
  getCampaignStats: (id)       => api.get(`/api/campaigns/${id}/stats`),
  createCampaign:   (data)     => api.post('/api/campaigns', data),
  updateCampaign:   (id, data) => api.put(`/api/campaigns/${id}`, data),
  startCampaign:    (id)       => api.post(`/api/campaigns/${id}/start`),
  startSMSFirst:    (id)       => api.post(`/api/sms-first/${id}/start`),
  stopSMSFirst:     (id)       => api.post(`/api/sms-first/${id}/stop`),
  getSMSFirstStatus:(id)       => api.get(`/api/sms-first/${id}/status`),
  getSMSFirstLeads: (id)       => api.get(`/api/sms-first/${id}/leads`),
  pauseCampaign:    (id)       => api.post(`/api/campaigns/${id}/pause`),
  stopCampaign:     (id)       => api.post(`/api/campaigns/${id}/stop`),
  deleteCampaign:   (id)       => api.delete(`/api/campaigns/${id}`),
}

// ─── Phones ──────────────────────────────────────────────────────────────────
export const phones = {
  getPhones:      ()             => api.get('/api/phones'),
  getPhoneHealth: ()             => api.get('/api/phones/health'),
  getPlanStatus:  ()             => api.get('/api/phones/plan-status'),
  addPhone:       (data)         => api.post('/api/phones', data),
  provision:      (area_code, friendly_name) => api.post('/api/phones/provision', { area_code, friendly_name }),
  syncFromVapi:   ()             => api.post('/api/phones/sync-vapi'),
  fixWebhooks:    ()             => api.post('/api/phones/fix-webhooks'),
  provisionPool:  ()             => api.post('/api/phones/provision-pool'),
  updatePhone:    (id, data)     => api.put(`/api/phones/${id}`, data),
  releasePhone:   (id, reason)   => api.post(`/api/phones/${id}/release`, { reason }),
  deletePhone:    (id)           => api.delete(`/api/phones/${id}`),
  bulkAddPhones:  (numbers)      => api.post('/api/phones/bulk', { numbers }),
}

// ─── Deals ───────────────────────────────────────────────────────────────────
export const deals = {
  getDeals:          (params)       => api.get('/api/deals', { params }),
  getDeal:           (id)           => api.get(`/api/deals/${id}`),
  getDealActivity:   (id)           => api.get(`/api/deals/${id}/activity`),
  getTitleLog:       (id)           => api.get(`/api/deals/${id}/title-log`),
  createDeal:        (data)         => api.post('/api/deals', data),
  updateDeal:        (id, data)     => api.put(`/api/deals/${id}`, data),
  generateContract:  (id, type)     => api.post(`/api/deals/${id}/generate-contract`, { type }),
  sendContract:      (id, type, data) => api.post(`/api/deals/${id}/send-contract`, { type, ...data }),
  sendToTitle:       (id, data)     => api.post(`/api/deals/${id}/send-to-title`, data),
  startBuyerCampaign:(id)           => api.post(`/api/deals/${id}/start-buyer-campaign`),
}

export const contracts = {
  createContract:       (data)  => api.post('/api/contracts/create_contract', data),
  startSigningSession:  (data)  => api.post('/api/contracts/start_signing_session', data),
  getSignedContract:    (id)    => api.get(`/api/contracts/get_signed_contract/${id}`),
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

export const followUps = {
  getAll:          (params) => api.get('/api/follow-ups', { params }),
  createFollowUp:  (data)   => api.post('/api/follow-ups/create_follow_up', data),
  updateFollowUp:  (id, data) => api.put(`/api/follow-ups/${id}`, data),
}

export const propertyPhotos = {
  upload:   (data) => api.post('/api/property-photos/upload_property_photos', data),
  getByDeal:(dealId) => api.get(`/api/property-photos/get_property_photos_for_buyer/${dealId}`),
}

// ─── Operator preferences ─────────────────────────────────────────────────────
export const preferences = {
  get:    ()       => api.get('/api/operator/preferences'),
  update: (data)   => api.put('/api/operator/preferences', data),
  activity: (p)    => api.get('/api/operator/activity', { params: p }),
}

// ─── Conversations ────────────────────────────────────────────────────────────
export const conversations = {
  sendSms:       (data)    => api.post('/api/conversations/send-sms', data),
  handleReply:   (data)    => api.post('/api/conversations/handle-reply', data),
  scheduleCall:  (data)    => api.post('/api/conversations/schedule-call', data),
  getByDeal:     (dealId)  => api.get(`/api/conversations/${dealId}`),
}

// ─── Academy ─────────────────────────────────────────────────────────────────
export const academy = {
  getLessons:      ()              => api.get('/api/academy/lessons'),
  getProgress:     (userId)        => api.get(`/api/academy/progress/${userId}`),
  completeLesson:  (data)          => api.post('/api/academy/complete-lesson', data),
  getGlossary:     ()              => api.get('/api/academy/glossary'),
}

// ─── Waitlist ─────────────────────────────────────────────────────────────────
export const waitlist = {
  join:  (data) => api.post('/api/waitlist/veori-credits', data),
  count: ()     => api.get('/api/waitlist/count'),
}

// ─── Notifications ────────────────────────────────────────────────────────────
export const notifications = {
  getAll:      (params) => api.get('/api/notifications', { params }),
  markRead:    (id)     => api.put(`/api/notifications/${id}/read`),
  markAllRead: ()       => api.put('/api/notifications/read-all'),
  getUnreadCount: ()    => api.get('/api/notifications/unread-count'),
}

// ─── Analytics (extended) ─────────────────────────────────────────────────────
export const analyticsExtended = {
  kpis:               (params) => api.get('/api/analytics/kpis', { params }),
  dealFlowByMonth:    (params) => api.get('/api/analytics/deal-flow-by-month', { params }),
  performanceByState: (params) => api.get('/api/analytics/performance-by-state', { params }),
  sellerSegments:     (params) => api.get('/api/analytics/seller-segments', { params }),
  dealTypes:          (params) => api.get('/api/analytics/deal-types', { params }),
  regionalPerformance:(params) => api.get('/api/analytics/regional-performance', { params }),
  aiInsights:         ()       => api.get('/api/analytics/ai-insights'),
}

// ─── Wealth Playbook ──────────────────────────────────────────────────────────
export const wealth = {
  checkAssessment:    ()           => api.get('/api/wealth/assessment/check'),
  submitAssessment:   (data)       => api.post('/api/wealth/assessment', data),
  getPlaybook:        (userId)     => api.get(`/api/wealth/playbook/${userId}`),
  regeneratePlaybook: (userId)     => api.post(`/api/wealth/regenerate/${userId}`),
  getStrategies:      ()           => api.get('/api/wealth/strategies'),
  getStrategy:        (id)         => api.get(`/api/wealth/strategy/${id}`),
  getScore:           (userId)     => api.get(`/api/wealth/score/${userId}`),
  updateScore:        (actionType) => api.post('/api/wealth/score/update', { action_type: actionType }),
  calculate:          (data)       => api.post('/api/wealth/calculator', data),
  getFeed:            ()           => api.get('/api/wealth/feed'),
  updateProgress:     (data)       => api.post('/api/wealth/strategy/progress', data),
}

// ─── SMS Inbox ────────────────────────────────────────────────────────────────
export const inbox = {
  getConversations: ()         => api.get('/api/sms/inbox'),
  getThread:        (leadId)   => api.get(`/api/sms/conversation/${leadId}`),
  send:             (lead_id, message) => api.post('/api/sms/send', { lead_id, message }),
  markRead:         (leadId)   => api.post(`/api/sms/read/${leadId}`),
}

// ─── Missed Calls ─────────────────────────────────────────────────────────────
export const missedCalls = {
  getAll:       (params)  => api.get('/api/missed-calls', { params }),
  getSettings:  ()        => api.get('/api/missed-calls/settings'),
  saveSettings: (data)    => api.put('/api/missed-calls/settings', data),
}

// ─── Appointments ─────────────────────────────────────────────────────────────
export const appointments = {
  getAll:           (params)       => api.get('/api/appointments', { params }),
  create:           (data)         => api.post('/api/appointments', data),
  update:           (id, data)     => api.put(`/api/appointments/${id}`, data),
  remove:           (id)           => api.delete(`/api/appointments/${id}`),
  getAvailability:  ()             => api.get('/api/appointments/availability'),
  saveAvailability: (data)         => api.post('/api/appointments/availability', data),
  removeAvailability: (id)         => api.delete(`/api/appointments/availability/${id}`),
}

export default api
