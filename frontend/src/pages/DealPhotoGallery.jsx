import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Image as ImageIcon } from 'lucide-react'
import { propertyPhotos } from '../services/api'

export default function DealPhotoGallery() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [photos, setPhotos] = useState([])
  const [deal, setDeal] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    propertyPhotos.getByDeal(id)
      .then((r) => {
        setPhotos(r.data?.photos || [])
        setDeal(r.data?.deal || null)
      })
      .catch(() => {
        setPhotos([])
        setDeal(null)
      })
      .finally(() => setLoading(false))
  }, [id])

  return (
    <div style={{ padding: 24, height: '100%', overflowY: 'auto' }}>
      <button
        onClick={() => navigate(`/deals/${id}`)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 18,
          background: 'none',
          border: 'none',
          color: 'var(--t3)',
          cursor: 'pointer',
          padding: 0,
          fontSize: 12,
        }}
      >
        <ArrowLeft size={14} /> Deal workspace
      </button>

      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, color: 'var(--t1)', margin: 0 }}>Property Photos</h1>
        <p style={{ fontSize: 13, color: 'var(--t3)', marginTop: 6 }}>
          {deal?.property_address || 'Deal gallery'}
        </p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--t3)' }}>Loading gallery…</p>
      ) : photos.length === 0 ? (
        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 16,
          background: 'var(--card-bg)',
          padding: 32,
          textAlign: 'center',
        }}>
          <ImageIcon size={28} style={{ color: 'var(--t4)', marginBottom: 12 }} />
          <p style={{ color: 'var(--t2)', margin: 0 }}>No photos uploaded yet for this deal.</p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 16,
        }}>
          {photos.map((photo) => (
            <div
              key={photo.id}
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                overflow: 'hidden',
              }}
            >
              {photo.signed_url ? (
                <img
                  src={photo.signed_url}
                  alt={photo.caption || 'Property photo'}
                  style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <div style={{ height: 220, background: 'var(--surface-bg)' }} />
              )}
              <div style={{ padding: 12 }}>
                <p style={{ color: 'var(--t2)', fontSize: 12, margin: 0 }}>
                  {photo.caption || 'Seller-uploaded photo'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
