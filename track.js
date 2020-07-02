const debug = require('debug')('baptism:track')
const flags = require('./flags.json')
const ffmpeg = require('fluent-ffmpeg')
const fs = require('fs')
const getSoxi = require('./soxi')
const getSpectrogram = require('./spectrogram')
const getStats = require('./stats')
const mime = require('mime')
const Resource = require('nanoresource')

class Track extends Resource {
  constructor(source, opts = {}) {
    super()
    this.filename = source
    this.fd = 0
    this.type = mime.getType(this.filename)

    if (opts.trackNumber) {
      this.trackNumber = opts.trackNumber
    }
  }

  _open (cb) {
    debug('Now opening file ...', this.filename)
    fs.open(this.filename, 'r', (err, fd) => {
      if (err) return cb(err)
      this.fd = fd
      cb(null)
    })
  }

  _close (cb) {
    debug('Now closing file ...')
    fs.close(this.fd, cb)
  }

  silence (cb) {
    this.open((err) => {
      if (err) return cb(err)
      const silences = []

      function validateSilences(silObj) {
        const silenceStarts = Object.keys(silObj)
        return {
          start: Number(silenceStarts.shift()) === 0,
          end: Number(silenceStarts.pop()) > 0
        }
      }

      function parseSilences(sils) {
        const starts = []
        const maps = {}
        for (const s of sils) {
          if (s.includes('silence_start: ')) {
            starts.push(parseFloat(s.split('silence_start: ')[1]))
          } else if (s.includes('silence_duration: ')) {
            maps[starts.pop()] = s.split('silence_duration: ')[1]
          }
        }
        return [ maps, validateSilences(maps) ]
      }

      const ffmpegCmd = ffmpeg(this.filename)
        .audioFilters(flags.silence)
        .format('null')
        .output('-')
        .on('stderr', d => {
          if (`${d}`.includes('silencedetect')) {
            silences.push(`${d}`)
          }
        })
        .on('error', err => { return this.inactive(cb, err) })
        .on('end', () => {
          debug('finished', silences)
          const parsedSilences = parseSilences(silences)
          this.silences = parsedSilences
          this.inactive(cb, null, parsedSilences)
        })

      ffmpegCmd.run()
    })
  }

  size (cb) {
    this.open((err) => {
      if (err) return cb(err)
      if (!this.active(cb)) return
      fs.fstat(this.fd, (err, st) => {
        if (err) return this.inactive(cb, err)
        this.inactive(cb, null, st.size)
      })
    })
  }

  soxi (cb) {
    this.open((err) => {
      if (err) return cb(err)
      if (!this.active(cb)) return
      getSoxi(this.filename, (err, so) => {
        if (err) return cb(err)
        this.format = so
        this.inactive(cb, null, so)
      })
    })
  }

  spectrogram (cb) {
    this.open((err) => {
      if (err) return cb(err)
      if (!this.active(cb)) return
      getSpectrogram(this.filename, (err, sp) => {
        if (err) return cb(err)
        this.spectrogramFile = sp
        this.spectrogram = Buffer.from(fs.readFileSync(this.spectrogramFile))
          .toString('base64')
        this.inactive(cb, null, sp)
      })
    })
  }

  stats (cb) {
    this.open((err) => {
      if (err) return cb(err)
      if (!this.active(cb)) return
      getStats(this.filename, (err, st) => {
        if (err) return cb(err)
        this.stats = st
        this.inactive(cb, null, st)
      })
    })
  }

  waveform (cb) {
    this.open((err) => {
      if (err) return cb(err)
      if (!this.active(cb)) return

      const waveformPath = `${this.filename}_waveform.png`

      const ffmpegCmd = ffmpeg(this.filename)
        .complexFilter(flags.waveform)
        .output(waveformPath)
        .on('error', err => { return this.inactive(cb, err) })
        .on('end', () => {
          debug('waveform finished', waveformPath)
          this.waveformFile = waveformPath
          this.waveform = Buffer.from(fs.readFileSync(this.waveformFile))
            .toString('base64')
          this.inactive(cb, null, waveformPath)
        })

      ffmpegCmd.run()

    })
  }
}

module.exports = Track
