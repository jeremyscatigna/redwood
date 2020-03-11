import { mergeSchemas, addResolveFunctionsToSchema } from 'apollo-server-lambda'
import merge from 'lodash.merge'
import omitBy from 'lodash.omitby'

import * as rootSchema from './rootSchema'

const mapFieldsToService = ({
  fields = {},
  resolvers: unmappedResolvers,
  services,
}: any) =>
  Object.keys(fields).reduce((resolvers, name) => {
    // Does the function already exist in the resolvers from the schema definition?
    if (resolvers?.[name]) {
      return resolvers
    }

    // Does a function exist in the service?
    if (services?.[name]) {
      return {
        ...resolvers,
        // Map the arguments from GraphQL to an ordinary function a service would
        // expect.
        [name]: (root: any, args: any, context: any) =>
          services[name](args, { root, context }),
      }
    }

    return resolvers
  }, unmappedResolvers)

/**
 * This iterates over all the schemas definitions and figures out which resolvers
 * are missing, it then tries to add the missing resolvers from the corresponding
 * service.
 */
const mergeResolversWithServices = ({ schema, resolvers, services }: any) => {
  const mergedServices = merge(
    {},
    ...Object.keys(services).map((name) => services[name])
  )

  // Get a list of types that have fields.
  // TODO: Figure out if this would interfere with other types: Interface types, etc.`
  const typesWithFields = Object.keys(schema.getTypeMap())
    .filter((name) => !name.startsWith('_'))
    .filter((name) => typeof schema.getType(name).getFields !== 'undefined')
    .map((name) => {
      return schema.getType(name)
    })

  const mappedResolvers = typesWithFields.reduce((acc, type) => {
    // Services export Query and Mutation field resolvers as named
    // exports, but other GraphQLObjectTypes are exported as an object
    // named after the type.
    let servicesForType = mergedServices
    if (!['Query', 'Mutation'].includes(type.name)) {
      servicesForType = mergedServices?.[type.name]
    }

    return {
      ...acc,
      [type.name]: mapFieldsToService({
        fields: type.getFields(),
        resolvers: resolvers?.[type.name],
        services: servicesForType,
      }),
    }
  }, {})

  return omitBy(
    {
      ...resolvers,
      ...mappedResolvers,
    },
    (v) => typeof v === 'undefined'
  )
}

const mergeResolvers = (schemas: any) =>
  omitBy(
    merge(
      {},
      ...[
        rootSchema.resolvers,
        ...Object.values(schemas).map(({ resolvers }: any) => resolvers),
      ]
    ),
    (v) => typeof v === 'undefined'
  )

/**
 * Merge GraphQL typeDefs and resolvers into a single schema.
 *
 * @example
 * ```js
 * const schemas = importAll('api', 'graphql')
 * const services = importAll('api', 'services')
 *
 * const schema = makeMergedSchema({
 *  schema,
 *  services: makeServices({ services }),
 * })
 * ```
 */
export const makeMergedSchema = ({ schemas, services }: any) => {
  const schema = mergeSchemas({
    schemas: [
      rootSchema.schema,
      ...Object.values(schemas).map(({ schema }: any) => schema),
    ],
  })

  const resolvers = mergeResolversWithServices({
    schema,
    resolvers: mergeResolvers(schemas),
    services,
  })
  addResolveFunctionsToSchema({ schema, resolvers })

  return schema
}
