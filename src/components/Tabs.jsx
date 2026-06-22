function Tabs({ tabs, activeTab, onChange }) {
  return (
    <div className="tabs" role="tablist" aria-label="Fuentes de datos">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id

        return (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-${tab.id}`}
            className={`tab-button${tab.primary ? ' is-primary' : ''}${isActive ? ' is-active' : ''}`}
            onClick={() => onChange(tab.id)}
          >
            <span className="tab-button__label">{tab.label}</span>
            <span className="tab-button__description">{tab.description}</span>
          </button>
        )
      })}
    </div>
  )
}

export default Tabs
