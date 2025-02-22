const fs = require('fs')
const axios = require('axios')
const { differenceInBusinessDays } = require('date-fns')
const { calc, getCidade } = require('./../calculos/dhl/nacional')

class CalcDHL {
  constructor(
    orgcty,
    dstcty,
    peso_cons,
    orgcep,
    dstcep,
    orgctr,
    dstctr,
    excedmed,
    excedpeso,
    pacotes
  ) {
    this.props = {
      orgcty,
      dstcty,
      peso_cons,
      orgcep,
      dstcep,
      orgctr,
      dstctr,
      excedmed,
      excedpeso,
      pacotes
    }
  }
  cotarInternacional = async () => {
    const { dstcty, peso_cons, dstctr, dstcep } = this.props
    const shpDate_ = await CalcDHL.verificarFeriado()
    const shpDate = new Date(shpDate_ + ' 00:00:00')
    const params = {
      dtbl: 'N',
      wgt0: peso_cons,
    }
    const dctUrl = `http://dct.dhl.com/data/quotation/?dtbl=N&declVal=&declValCur=BRL&wgtUom=kg&dimUom=cm&noPce=1&wgt0=${peso_cons}&w0=0&l0=&h0=&shpDate=${shpDate_}&orgCtry=BR&orgCity=COTIA&dstCtry=${dstctr}&dstCity=${dstcty}&dstZip=${dstcep}`
    const quote_ = await axios.get(dctUrl)
    const quote = quote_.data
    const quoteCount = quote.count
    const products = quote.quotationList.quotation
      .filter(prod => prod.prodNm.toLowerCase() == "express worldwide")
      .map(prod => {
        const diffDays = differenceInBusinessDays(new Date(prod.estDeliv.split(', ')[1]), new Date())
        return {
          produto: prod.prodNm,
          prazo: `${diffDays} - ${diffDays + 2}`,
          valor: `R$ ${Number((prod.estTotPrice.replace('BRL', '').replace(',', '') * .98).toFixed(2)).toLocaleString('pt-br', { minimumFractionDigits: 2 })}`
        }
      })

    //VERIFICAÇÃO DE ERRO
    if (quoteCount === 0) {
      return 'DHL INTER: ' + quote.errorMessage
    } else {
      return {
        service: 'dhl',
        produtos: products
      }
    }
  }

  cotarNacional = async () => {
    const { orgcty, dstcty, peso_cons, excedmed, excedpeso, orgcep, dstcep, pacotes } = this.props

    const cidade_origem = getCidade(orgcep.substring(0, 5))
    const cidade_destino = getCidade(dstcep.substring(0, 5))

    console.log({ cidade_origem, cidade_destino })
    

    if (!cidade_origem) {
      return {
        erro: {
          type: 'origem-cep-error'
        }
      }
    } 
    else if (!cidade_destino) {
      return {
        erro: {
          type: 'destino-cep-error'
        }
      }
    }
    else {
      const input = {
        cidade: {
          origem: orgcep.substring(0, 5),
          destino: dstcep.substring(0, 5),
        },
        pacotes     
      }
      const resultado = calc(input)
      let valor = resultado.total
      if (resultado.zona == 1 && !resultado.area_remota.status) {
        valor += 20
      }
      else if (resultado.zona != 1 && !resultado.area_remota.status) {
        valor += 10
      }

      const prazo = await this.obterPrazoNac()

      //VERIFICAÇÃO QUANDO COTAÇÃO -> OK E PRAZO -> ERRO
      if (prazo === 'erro') {
        const output = {
          erro: 'DHL Indisponível para localidade selecionada',
        }
        return output
      }

      const output = {
        service: 'dhl-nacional',
        valor: `R$ ` + valor.toLocaleString(),
        prazo: prazo,
      }
      return output
    }

  }

  obterPrazoNac = async () => {
    const { orgctr, orgcep, dstctr, dstcep } = this.props

    const shpDate = await CalcDHL.verificarFeriado()
    const shpDate_ = new Date(shpDate)
    shpDate_.setHours('00')

    //MONTAGEM DE URL
    const dctUrl = `https://dct.dhl.com/data/quotation/?wgtUom=kg&dimUom=cm&noPce=1&wgt0=0.1&w0=0&l0=0&h0=0&shpDate=${shpDate}&orgCtry=${orgctr}&orgZip=${orgcep}&dstCtry=${dstctr}&dstZip=${dstcep}`

    //GET REQUEST PARA URL, RETORNA JSON
    const prazo_ = await axios.get(dctUrl)
    const prazo = prazo_.data

    if (prazo.count == 1) {
      const strPrazo = prazo.quotationList.quotation[0].estDeliv,
        dataPrazo = strPrazo.split(',')[1].substring(1),
        dataEntregaDHL = new Date(dataPrazo)
      shpDate_.setHours('00')
      dataEntregaDHL.setHours('00')
      const diffDataDHL = dataEntregaDHL.getTime() - shpDate_.getTime()
      let prazoDHL = Math.ceil(diffDataDHL / (1000 * 3600 * 24))
      prazoDHL =
        prazoDHL > 4 && prazoDHL < 10
          ? prazoDHL - 2
          : prazoDHL > 11 && prazoDHL < 17
            ? prazoDHL - 4
            : prazoDHL > 18
              ? prazoDHL - 6
              : prazoDHL

      return prazoDHL === 0 ? 1 : prazoDHL
    } else {
      return 'erro'
    }
  }

  static verificarFeriado = async () => {
    const hoje = new Date()
    hoje.setDate(hoje.getDate() + ((1 + 7 - hoje.getDay()) % 7))

    const anoAtual = hoje.getFullYear()

    let shpDate_ = hoje.toISOString().substring(0, 10)
    let arrDateFeriado = shpDate_.split('-')
    let dateFeriado = `${arrDateFeriado[2]}/${arrDateFeriado[1]}/${arrDateFeriado[0]}`

    //FETCH CALENDAR FOR YEAR
    let res2 = await axios.get(
      `https://api.calendario.com.br/?json=true&ano=${anoAtual}&token=${process.env.FERIADO_API_KEY}`
    )

    let res3 = res2.data.filter((dia) => dia.date === dateFeriado)[0]

    //IF HOLIDAY, RETURNS NEXT MONDAY
    if (res3 === undefined) {
      return shpDate_
    } else {
      let res4 = res3.type.split(' ')[0]
      if (res4 === 'Feriado' || res4 === 'Facultativo') {
        hoje.setDate(hoje.getDate() + 1)
        hoje.setDate(hoje.getDate() + ((1 + 7 - hoje.getDay()) % 7))
        let shpDate_ = hoje.toISOString().substring(0, 10)
        return shpDate_
      } else return shpDate_
    }
  }
}

module.exports = CalcDHL
