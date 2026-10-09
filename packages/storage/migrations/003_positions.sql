CREATE TABLE report_positions (report_id uuid NOT NULL REFERENCES reports(id),owner text NOT NULL,amount numeric(40,0) NOT NULL,excluded_amount numeric(40,0) NOT NULL,body jsonb NOT NULL,PRIMARY KEY(report_id,owner));
CREATE INDEX report_positions_owner ON report_positions(owner,report_id);
CREATE TABLE chain_transactions (signature text NOT NULL,parser_version text NOT NULL,slot numeric(20,0) NOT NULL,body jsonb NOT NULL,PRIMARY KEY(signature,parser_version));
CREATE TABLE token_launches (mint text NOT NULL,parser_version text NOT NULL,signature text NOT NULL,slot numeric(20,0) NOT NULL,body jsonb NOT NULL,PRIMARY KEY(mint,parser_version));
CREATE TABLE report_comparisons (report_id uuid PRIMARY KEY REFERENCES reports(id),previous_report_id uuid REFERENCES reports(id),body jsonb NOT NULL);
