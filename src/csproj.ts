import * as vscode from 'vscode'
import * as fs from 'mz/fs'
import * as path from 'path'

import {Csproj, XML} from './types'

const etree = require('@derflatulator/elementtree')
const stripBom = require('strip-bom')

export class NoCsprojError extends Error {}

let _cacheXml: { [path: string]: XML } = Object.create(null)

export async function getCsprojPath(fileDir: string, walkUp = true): Promise<string> {
    if (!path.isAbsolute(fileDir))
        fileDir = path.resolve(fileDir)

    const files = await fs.readdir(fileDir)
    const csproj = files.find(file => file.endsWith('.csproj'))
    if (csproj)
        return path.resolve(fileDir, csproj)
    if (walkUp) {
        const parent = path.resolve(fileDir, '..')
        if (parent === fileDir)
            throw new NoCsprojError('Reached fs root, no csproj found')
        return getCsprojPath(parent)
    }
    throw new NoCsprojError(`No csproj found in current directory: ${fileDir}`)
}

export function csprojHasFile(csproj: Csproj, filePath: string) {
    const filePathRel = relativeToCsproj(csproj, filePath)
    const project = csproj.xml.getroot()
    const match = project.find(`./ItemGroup/*[@Include='${filePathRel}']`)
    return !!match
}

export function relativeToCsproj(csproj: Csproj, filePath: string) {
    return path.relative(path.dirname(csproj.fsPath), filePath)
}

export function addFileToCsproj(csproj: Csproj, filePath: string, itemType: string) {
    const itemGroups = csproj.xml.getroot().findall('./ItemGroup')
    const itemGroup = itemGroups.length
        ? itemGroups[itemGroups.length - 1]
        : etree.SubElement(csproj.xml.getroot(), 'ItemGroup')
    const itemElement = etree.SubElement(itemGroup, itemType)
    itemElement.set('Include', relativeToCsproj(csproj, filePath))
}

export function removeFileFromCsproj(csproj: Csproj, filePath: string) {
    const root = csproj.xml.getroot()
    const filePathRel = relativeToCsproj(csproj, filePath)
    const itemGroups = root.findall('./ItemGroup')
    const found = itemGroups.some(itemGroup => {
        const element = itemGroup.find(`./*[@Include='${filePathRel}']`)
        if (element) {
            itemGroup.remove(element)
            return true
        }
        return false
    })
    if (!found)
        throw new Error(`could not file file ${filePathRel} in csproj ${csproj.name}`)
}

async function readFile(path: string): Promise<string> {
    return stripBom(await fs.readFile(path, 'utf8'))
}

export async function persistCsproj(csproj: Csproj, indent = 2) {
    const xmlString = csproj.xml.write({ indent })

    // Add byte order mark.
    const xmlFinal = ('\ufeff' + xmlString)
        .replace(/\n/g, '\r\n') // use CRLF
        .replace(/\r?\n$/, '') // no newline at end of file

    await fs.writeFile(csproj.fsPath, xmlFinal)
}

export async function getCsprojForFile(filePath: string): Promise<Csproj> {
    const fsPath = await getCsprojPath(path.dirname(filePath))
    const name = path.basename(fsPath)
    const xml = await loadCsproj(fsPath)
    return { fsPath, name, xml }
}

async function loadCsproj(csprojPath: string) {
    if (!(csprojPath in _cacheXml)) {
        const csprojContent = await readFile(csprojPath)
        _cacheXml[csprojPath] = <XML>etree.parse(csprojContent)
    }
    return _cacheXml[csprojPath]
}

let _doInvalidation = true

export function disableInvalidation() { _doInvalidation = false }
export function enableInvalidation() { _doInvalidation = true }

export function invalidateCsproj(filePath: string) {
    if (_doInvalidation)
        delete _cacheXml[filePath]
}

export function invalidateAllCsproj() {
    _cacheXml = Object.create(null)
}