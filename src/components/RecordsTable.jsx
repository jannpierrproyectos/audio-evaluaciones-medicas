function TableStateRow({ columnsLength, title, description, tone = 'neutral' }) {
  return (
    <tr>
      <td colSpan={columnsLength}>
        <div className={`table-state table-state--${tone}`}>
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
      </td>
    </tr>
  )
}

function RecordsTable({
  columns,
  records,
  loading,
  error,
  selectedRecordId,
  onSelectRecord,
}) {
  const hasRecords = records.length > 0

  return (
    <section
      className="panel panel--table"
      id="panel-sheets"
      role="tabpanel"
      aria-labelledby="tab-sheets"
    >
      <div className="panel__header">
        <div>
          <p className="section-label">Registros</p>
          <h3>Listado principal</h3>
        </div>
        <span className="ghost-chip">{records.length} registros</span>
      </div>

      <div className="table-shell">
        <table className="records-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <TableStateRow
                columnsLength={columns.length}
                title="Cargando registros"
                description="Estamos leyendo la pestana trabajadores del Google Sheets principal."
              />
            )}

            {!loading && error && (
              <TableStateRow
                columnsLength={columns.length}
                title="No se pudo cargar el listado"
                description={error}
                tone="error"
              />
            )}

            {!loading && !error && !hasRecords && (
              <TableStateRow
                columnsLength={columns.length}
                title="Aun no hay registros cargados"
                description="No encontramos filas utiles en la pestana trabajadores del Google Sheets."
              />
            )}

            {!loading &&
              !error &&
              hasRecords &&
              records.map((record) => {
                const isSelected = selectedRecordId === record.id

                return (
                  <tr
                    key={record.id}
                    className={`record-row${isSelected ? ' is-selected' : ''}`}
                    onClick={() => onSelectRecord(record.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelectRecord(record.id)
                      }
                    }}
                    tabIndex={0}
                  >
                    <td>{record.ui.display_name}</td>
                    <td>{record.ui.company_label}</td>
                    <td>{record.ui.ficha_label}</td>
                    <td>{record.ui.aptitude_label}</td>
                    <td>{record.ui.text_status_label}</td>
                    <td>{record.ui.audio_status_label}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default RecordsTable
