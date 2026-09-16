import React from 'react'
import VeoriLogo from './VeoriLogo'

// Shows the workspace's logo and name when white label is set, otherwise Veori's.
export default function BrandMark({ brand, size = 34, showName = true, nameStyle = {}, fallbackName = 'Veori' }) {
  const name = brand?.brand_name || fallbackName
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      {brand?.logo_url
        ? <img src={brand.logo_url} alt={name} style={{ height: size, maxWidth: size * 4, objectFit: 'contain', flexShrink: 0 }} />
        : (!brand?.brand_name && <VeoriLogo size={size} />)}
      {showName && (
        <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...nameStyle }}>{name}</span>
      )}
    </div>
  )
}
