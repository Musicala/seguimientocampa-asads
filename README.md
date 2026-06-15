# Seguimiento de Campanas Ads

App web para registrar manualmente campanas de marketing de Musicala, guardar metricas en Firebase Firestore y leer el dashboard desde Firebase.

## Requisitos

- Node.js 18 o superior
- Proyecto Firebase `marketing-musicala`
- Proveedor Google habilitado en Firebase Auth
- Firestore habilitado
- Firebase CLI para desplegar: `npm install -g firebase-tools`

## Correr localmente

```bash
npm install
npm run dev
```

Abre la URL que muestra Vite, normalmente:

```text
http://127.0.0.1:5173
```

Inicia sesion con Google desde la barra superior. Sin sesion, Firestore no permite leer ni escribir.

## Modelo Firestore

Coleccion principal:

```text
campaigns/{campaignId}
```

Campos principales:

- `id`
- `name`
- `platform`: `meta`, `google`, `tiktok`, `otro`
- `objective`
- `status`: `activa`, `pausada`, `finalizada`
- `budget`
- `startDate`
- `endDate`
- `notes`
- `createdAt`
- `updatedAt`
- `createdBy`

Subcoleccion:

```text
campaigns/{campaignId}/metrics/{metricId}
```

Campos principales:

- `date`
- `spend`
- `impressions`
- `reach`
- `clicks`
- `leads`
- `messages`
- `conversions`
- `sales`
- `revenue`
- `notes`
- `createdAt`
- `updatedAt`

Coleccion opcional preparada:

```text
musicalaReality/{docId}
```

## Build

## Informes para decision

En el Dashboard hay dos acciones:

- **Descargar informe**: genera un archivo Markdown con resumen ejecutivo, KPIs, ranking de campanas y alertas segun los filtros activos.
- **Copiar prompt IA**: copia un prompt listo para pegar en otra IA, con contexto, datos y formato de respuesta esperado para tomar decisiones sin inventar informacion.

Ambas salidas usan solo los datos reales cargados en Firestore.

## Decisiones, alertas y reactivacion

El dashboard calcula automaticamente:

- Decision sugerida por campana: escalar, optimizar, pausar, medir ventas o reactivar.
- Alertas del mes: pocas campanas activas, gasto sin leads, leads sin ventas, presupuesto cerca del limite y falta de realidad comercial.
- Campanas ganadoras y finalizadas que pueden reactivarse.
- Metricas nuevas: costo por venta, clic a lead, lead a venta e ingreso por lead.

Las campanas finalizadas muestran accion **Reactivar**. Esto crea una nueva campana activa basada en la campana original, con trazabilidad en notas.

## Realidad Musicala

En la vista **Metricas** se puede registrar informacion interna que no viene de plataformas:

- Contactos nuevos
- Leads calificados
- Clases de prueba
- Matriculas
- Servicio vendido
- Ingreso real

Estos datos se guardan en `musicalaReality` para una fase posterior de atribucion y reportes comerciales.

## Importar datos existentes desde Excel

En la vista **Campanas**, usa **Importar Excel** y selecciona el archivo `.xlsx` existente.

El importador busca estas hojas:

- `campaigns` o `campañas`
- `Metricas` o `Métricas`
- `Parametros` o `Parámetros`

Las campañas se guardan en `campaigns/{campaignId}`. Las métricas se guardan en `campaigns/{campaignId}/metrics/{date}_{campaignId}`, por lo que volver a importar el mismo archivo actualiza esos registros en vez de duplicarlos.

```bash
npm run build
```

El build genera `dist/` y copia los scripts heredados necesarios para conservar la interfaz actual.

## Desplegar en Firebase Hosting

```bash
firebase login
firebase use marketing-musicala
npm run build
firebase deploy --only hosting
```

## Desplegar reglas de Firestore

```bash
firebase deploy --only firestore:rules
```

Las reglas iniciales estan en `firestore.rules` y permiten leer/escribir solo a usuarios autenticados.

## Integraciones futuras

No hay tokens privados ni secretos de Meta Ads o Google Ads en el frontend. Cuando se conecten esas APIs, las credenciales deben vivir en backend o Cloud Functions, y el frontend debe llamar endpoints propios o documentos sincronizados en Firestore.
