const DEFAULT_LOADER_VERSION = '0.0.1'
const DEFAULT_WELCOME_PARAM = 'widgetParameter (base64 payload)'
const ALLOWED_WIDGET_FAMILIES = ['small', 'medium', 'large']
const LIBRARY_BASE_URL =
    'https://widgets.taoradar.space/main'

const welcomeLibraryInfo = {
    moduleUrl: buildLibraryResourceUrl(LIBRARY_BASE_URL, 'welcome/index.js'),
    manifestUrl: buildLibraryResourceUrl(LIBRARY_BASE_URL, 'welcome/manifest.json'),
    cacheKey: 'welcome_main',
}

async function launch(params = {}) {
    const runtimeConfig = params.config || {}
    if (!runtimeConfig.runsInWidget) {
        try {
            const moduleLoader = importLocalModuleLoader()
            const welcomeModulePath = await moduleLoader.importVersionedModule({
                library: welcomeLibraryInfo,
                scriptPath: module.filename,
                debug: !!params.debug,
                logLabel: 'launcher',
                importModuleFn: importModule,
            })
            const welcomeLibrary = importModule(welcomeModulePath)
            const welcomeParams = {
                widgetParameter: DEFAULT_WELCOME_PARAM,
                debug: !!params.debug,
                loaderVersion: String(params.loaderVersion || DEFAULT_LOADER_VERSION),
            }
            const widget = await welcomeLibrary.createWidget(welcomeParams)
            return presentAndComplete(widget, runtimeConfig)
        } catch (error) {
            const widget = createErrorWidget(
                'Unable to load welcome script',
                error && error.message ? error.message : String(error)
            )
            return presentAndComplete(widget, runtimeConfig)
        }
    }

    const providedParam = resolveProvidedWidgetParameter(params)
    if (!providedParam || providedParam.trim().length === 0) {
        const widget = createErrorWidget(
            'Configuration required',
            'Pass widgetParameter as a base64-encoded JSON string.'
        )
        return presentAndComplete(widget, runtimeConfig)
    }

    let payload = null
    try {
        payload = decodeWidgetPayload(providedParam)
    } catch (error) {
        const widget = createErrorWidget(
            'Invalid widgetParameter',
            'Unable to decode base64 JSON payload.'
        )
        return presentAndComplete(widget, runtimeConfig)
    }

    const validationError = validateWidgetPayload(payload)
    if (validationError) {
        const widget = createErrorWidget('Invalid payload', validationError)
        return presentAndComplete(widget, runtimeConfig)
    }

    const targetLibraryInfo = {
        moduleUrl: payload.moduleUrl,
        manifestUrl: payload.manifestUrl,
        cacheKey: payload.cacheKey || 'target',
    }

    try {
        const moduleLoader = importLocalModuleLoader()
        const targetModulePath = await moduleLoader.importVersionedModule({
            library: targetLibraryInfo,
            scriptPath: module.filename,
            debug: !!params.debug,
            logLabel: 'launcher',
            importModuleFn: importModule,
        })
        const targetLibrary = importModule(targetModulePath)

        // Scriptable sets runsInWidget === true on the home screen; enforce supportedFamilies only then.
        let familyError = null
        if (runtimeConfig.runsInWidget === true) {
            familyError = validateChildWidgetFamily(targetLibrary, runtimeConfig.widgetFamily)
        }
        if (familyError) {
            const widget = createErrorWidget('Unsupported widget size', familyError)
            return presentAndComplete(widget, runtimeConfig)
        }

        const childParams = mergeChildParamsFromLauncherAndPayload(params, payload)
        const libraryWidgetParam = readExportedWidgetParameterKey(targetLibrary)
        const resolvedWidgetParam = resolveWidgetParameter(libraryWidgetParam, childParams)
        const paramRequired = libraryWidgetParam.length > 0

        if (paramRequired && (!resolvedWidgetParam || resolvedWidgetParam.trim().length === 0)) {
            const widget = createErrorWidget(
                'Missing required parameter',
                `This widget expects "${libraryWidgetParam}" in payload.params.`
            )
            return presentAndComplete(widget, runtimeConfig)
        }

        const createWidgetParams = buildCreateWidgetParamsForChild(
            params,
            runtimeConfig,
            childParams,
            resolvedWidgetParam,
            libraryWidgetParam
        )
        const widget = await targetLibrary.createWidget(createWidgetParams)
        return presentAndComplete(widget, runtimeConfig)
    } catch (error) {
        const widget = createErrorWidget(
            'Unable to load target script',
            error && error.message ? error.message : String(error)
        )
        return presentAndComplete(widget, runtimeConfig)
    }
}

async function presentAndComplete(widget, runtimeConfig) {
    if (runtimeConfig.runsInWidget) {
        Script.setWidget(widget)
    } else {
        await widget.presentLarge()
    }
    Script.complete()
}

function createErrorWidget(title, message) {
    const widget = new ListWidget()
    widget.addText(title)
    widget.addSpacer(6)
    widget.addText(message)
    return widget
}

function importLocalModuleLoader() {
    if (typeof importModule !== 'function') {
        throw new Error('Scriptable runtime error: importModule is undefined in launcher.')
    }
    const fm = FileManager.local()
    const scriptPath = module.filename
    const scriptDir = scriptPath.replace(fm.fileName(scriptPath, true), '')
    const absoluteModulePath = fm.joinPath(scriptDir, 'module-loader_main.js')
    return importModule(absoluteModulePath)
}

function decodeWidgetPayload(base64String) {
    const data = Data.fromBase64String(String(base64String).trim())
    if (!data) throw new Error('Invalid base64')
    const jsonString = data.toRawString()
    return JSON.parse(jsonString)
}

function validateWidgetPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return 'widgetParameter payload must be a JSON object.'
    }
    if (!payload.moduleUrl || typeof payload.moduleUrl !== 'string') {
        return 'Payload field "moduleUrl" is required.'
    }
    if (payload.manifestUrl && typeof payload.manifestUrl !== 'string') {
        return 'Payload field "manifestUrl" must be a string when provided.'
    }
    if (payload.cacheKey && typeof payload.cacheKey !== 'string') {
        return 'Payload field "cacheKey" must be a string when provided.'
    }
    if (payload.params != null) {
        const p = payload.params
        const okObject = typeof p === 'object' && !Array.isArray(p)
        const okString = typeof p === 'string'
        if (!okObject && !okString) {
            return 'Payload field "params" must be an object, a JSON string, or omitted.'
        }
    }
    return null
}

function readExportedWidgetParameterKey(library) {
    if (!library || typeof library.widgetParameter !== 'string') {
        return ''
    }
    return library.widgetParameter.trim()
}

/** Passes launcher + Scriptable config + merged payload child fields into `createWidget`. */
function buildCreateWidgetParamsForChild(
    launcherParams,
    runtimeConfig,
    childParams,
    resolvedWidgetParameter,
    requiredParamKey
) {
    const child = normalizeChildParams(childParams)
    const out = {
        debug: !!launcherParams.debug,
        apiKey: launcherParams.apiKey,
        apiProvider: launcherParams.apiProvider,
        loaderVersion: String(launcherParams.loaderVersion || DEFAULT_LOADER_VERSION),
        ...runtimeConfig,
        params: child,
        ...child,
    }
    if (requiredParamKey) {
        out.widgetParameter = String(resolvedWidgetParameter ?? '')
    }
    return out
}

function resolveWidgetParameter(requiredParamName, childParams) {
    if (!requiredParamName || requiredParamName.length === 0) return ''
    if (childParams && Object.prototype.hasOwnProperty.call(childParams, requiredParamName)) {
        return String(childParams[requiredParamName] ?? '')
    }
    if (childParams && Object.prototype.hasOwnProperty.call(childParams, 'widgetParameter')) {
        return String(childParams.widgetParameter ?? '')
    }
    return ''
}

const RESERVED_PAYLOAD_ROOT_KEYS = new Set(['moduleUrl', 'manifestUrl', 'cacheKey', 'params'])

/** Merges non-reserved payload root keys with `payload.params` (nested wins on duplicate keys). */
function mergePayloadChildParams(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {}
    }
    const fromNested = normalizeChildParams(payload.params)
    const fromRoot = {}
    for (const key of Object.keys(payload)) {
        if (!RESERVED_PAYLOAD_ROOT_KEYS.has(key)) {
            fromRoot[key] = payload[key]
        }
    }
    return { ...fromRoot, ...fromNested }
}

const LAUNCHER_ARG_KEYS_SKIP = new Set(['widgetParameter', 'fileURLs', 'queryParameters', 'when', 'params'])

/** Host-side `config.params` / `args` (Scriptable); merged under payload in `mergeChildParamsFromLauncherAndPayload`. */
function childParamsFromLauncherArgs(launcherParams) {
    const out = {}
    if (!launcherParams || typeof launcherParams !== 'object') {
        return out
    }
    const cfg = launcherParams.config
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
        Object.assign(out, normalizeChildParams(cfg.params))
    }
    const args = launcherParams.args
    if (args && typeof args === 'object' && !Array.isArray(args)) {
        Object.assign(out, normalizeChildParams(args.params))
        for (const key of Object.keys(args)) {
            if (LAUNCHER_ARG_KEYS_SKIP.has(key)) {
                continue
            }
            out[key] = args[key]
        }
    }
    return out
}

function mergeChildParamsFromLauncherAndPayload(launcherParams, payload) {
    const fromHost = childParamsFromLauncherArgs(launcherParams)
    const fromPayload = mergePayloadChildParams(payload)
    return normalizeChildParams({ ...fromHost, ...fromPayload })
}

function normalizeChildParams(rawParams) {
    if (rawParams == null) {
        return {}
    }
    if (typeof rawParams === 'string') {
        const trimmed = rawParams.trim()
        if (!trimmed) {
            return {}
        }
        try {
            const parsed = JSON.parse(trimmed)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed
            }
        } catch (_) {}
        return {}
    }
    if (typeof rawParams !== 'object' || Array.isArray(rawParams)) {
        return {}
    }
    return rawParams
}

/**
 * Called only when `config.runsInWidget === true` (home-screen widget).
 * Child must export non-empty supportedFamilies; host must supply a valid widgetFamily.
 */
function validateChildWidgetFamily(library, requestedFamilyRaw) {
    const { error, families } = readStrictSupportedFamilies(library)
    if (error) {
        return error
    }
    const requestedFamily = normalizeWidgetFamily(requestedFamilyRaw)
    if (!requestedFamily) {
        return 'Missing or invalid widgetFamily from Scriptable. Expected: small, medium, or large.'
    }
    if (families.indexOf(requestedFamily) === -1) {
        return `This script does not support "${requestedFamily}". Supported: ${families.join(', ')}.`
    }
    return null
}

/**
 * @returns {{ error: null, families: string[] } | { error: string, families: null }}
 */
function readStrictSupportedFamilies(library) {
    if (!library || !Array.isArray(library.supportedFamilies)) {
        return {
            error:
                'Child widget must export supportedFamilies (e.g. ["small","large"]) — subset of small, medium, large.',
            families: null,
        }
    }
    const normalized = []
    for (const family of library.supportedFamilies) {
        const value = normalizeWidgetFamily(family)
        if (value && normalized.indexOf(value) === -1) {
            normalized.push(value)
        }
    }
    if (normalized.length === 0) {
        return {
            error:
                'Child widget supportedFamilies must include at least one valid name: small, medium, or large.',
            families: null,
        }
    }
    return { error: null, families: normalized }
}

function normalizeWidgetFamily(value) {
    if (value == null || value === '') {
        return null
    }
    const normalized = String(value).trim().toLowerCase()
    if (!normalized) {
        return null
    }
    return ALLOWED_WIDGET_FAMILIES.indexOf(normalized) !== -1 ? normalized : null
}

function coerceWidgetParameterString(value) {
    if (value == null) return ''
    if (typeof value === 'string') return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof Data !== 'undefined' && value instanceof Data) {
        try {
            const raw = value.toRawString()
            if (typeof raw === 'string' && raw.trim()) return raw.trim()
        } catch (_) {}
    }
    return ''
}

/** Base64 JSON payload from `widgetParameter` (launcher / args / config). */
function resolveProvidedWidgetParameter(launcherParams) {
    if (!launcherParams || typeof launcherParams !== 'object') {
        return ''
    }
    const candidates = [
        launcherParams.widgetParameter,
        launcherParams.args && launcherParams.args.widgetParameter,
        launcherParams.config && launcherParams.config.widgetParameter,
    ]
    for (const c of candidates) {
        const s = coerceWidgetParameterString(c)
        if (s) return s
    }
    return ''
}

function buildLibraryResourceUrl(baseUrl, fileName) {
    const parts = String(baseUrl).split('?')
    const basePath = parts[0].replace(/\/+$/, '')
    const query = parts.length > 1 ? parts.slice(1).join('?') : ''
    return query ? `${basePath}/${fileName}?${query}` : `${basePath}/${fileName}`
}

module.exports = {
    launch,
}
